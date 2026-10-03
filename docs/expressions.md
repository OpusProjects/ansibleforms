---
layout: default
title: Expressions
nav_order: 8
---

# Expressions

The `expression` formfield-attribute is a powerful feature in AnsibleForms that allows you to create dynamic forms with JavaScript expressions.

## Introduction

The expression attribute can be used on multiple formfield types:
- `enum` field - to populate dropdown options dynamically
- `expression` field - to grab or generate any form of data
- `table` field - to populate table data dynamically  

JavaScript expressions are evaluated either on the **server side** (default) or on the **client side** using the field property `runLocal`.

- **On the server side** (`runLocal: false` or omitted) - Code is limited to pre-defined functions, mainly to get external data from REST APIs, files, databases, etc.
- **On the client side** (`runLocal: true`) - Code leverages the full JavaScript engine in the browser sandbox for calculations, transformations, and manipulations.

## Security Concerns

Since expressions are evaluated using JavaScript's eval function, there can be a concern for code injection:

- **Server-side expressions** are limited to predefined functions - no arbitrary code injection is possible
- **Client-side expressions** are evaluated in the browser sandbox and can be considered safe

---

## Local Expressions

The following examples run with the field property `runLocal: true`.  
They execute in the browser sandbox and can leverage the full JavaScript engine.

{: .note }
> **Tip**: Use the type `local` as an alias for `type: expression, runLocal: true, hide: true, output: false`  
> **Tip**: Use the type `local_out` as an alias for `type: expression, runLocal: true, hide: true`  


### Naming Convention

Use string manipulations to apply naming conventions.

```javascript
'$(field1) $(field2)'.replace('-','_').toUpperCase()
```

### Calculation

Use math to make calculations.

```javascript
round($(field1)*$(field2)*Math.PI)   // Math.PI is native javascript
```

### Conversions

Convert bytes to gigabytes.

```javascript
($(size_bytes)/1024/1024/1024).toFixed(2)  // toFixed is native javascript method
```

### Convert Array of Objects to HTML Table

```javascript
fnToTable($(my_array_field),{
  tableClass = '',
  escapeHtml = true,
  emptyCell = '',
  includeHeader = true
})

// output : an html-table representation of the array of objects taken from another field called "my_array_field"
// tip : add tableClass = 'table table-striped table-bordered' for bootstrap styling
```

### Get a Name with Incremental Numbering

When working with auto numbering, you might want to find the next name in an array of strings that contains numbering.  
Also available as server side expression (prefixed with `fn.`).

```javascript
fnGetNumberedName(['server001','server002','server005'],'server###','server001',false)
// result : "server006"

fnGetNumberedName(['server001','server002','server005'],'server###','server001',true)
// result : "server003"

fnGetNumberedName($(fieldlist),'server###','server001',true)
// use another expression field as input for the array

// fnGetNumberedName(array,pattern,default,fillgaps)
// This function searches for a numbered pattern in a list of string, 
// increases the highest number and returns a name like the pattern
// - array : an array object, you can use a placeholder to an expression where you know it's an array
// - pattern : a string that hold the # as a digit
// - default : if no value is found, return this default
// - fillgaps : a boolean to indicate it can fill gaps in the numbers, 1,2,3,6 => 4
```

### Object-Array Manipulation

When working with object-arrays, you'll want to control and manipulate that data - filtering, altering, sorting.  
To make your life easy, AnsibleForms comes with a custom helper to keep your code clean.

```javascript
/* 
  fnArray.from($(your_array_field))                               // custom helper library
      .filterBy({property1:'value1'},{property2:'value2'}, ...}}  // filters the array by property value (* wildcards allowed)
      .regexBy({property1:'regex1'},{property2:'regex2'}, ...}}   // filters the array by property matched against regex
      .distinctBy('property1','property2', ...)                   // will make the array entries unique by property
      .selectAttr({prop1:'property1',prop2:'property2'})          // only selects a certain property, and you can relabel them
      .sortBy('property1','-property2', ...)                      // will order the array.  To have descending add a "-" (minus) before the property

  mylist:
  [
    {
      name:'Spiderman',
      has_ability: true,
      ability: 'Can do whatever a spider can'
    },
    {
      name:'Superman',
      has_ability: true,
      ability: 'Superstrong,Flying,Laserbeams'
    },     
    {
      name:'FamilyGuy',
      has_ability: false
    },    
    {
      name:'Wolverine',
      has_ability: true,
      ability: 'Enhanced healing'
    }                                                  
  ]
*/

fnArray.from($(mylist))         // take data from another field 'mylist'
.regexBy({name:'.*man$'})       // name must end with 'man'
.filterBy({has_ability:true})   // must have abilities
.selectAttr({name:'name',ability:'ability'})   // only take properties name and ability
.sortBy('-name')                // sort by name descending

/*
  result : 
  [
    {name:'Superman',ability:'Superstrong,Flying,Laserbeams'},
    {name:'Spiderman',ability:'Can do whatever a spider can'}
  ]
*/
```

### Object-Array Manipulation with Vanilla JavaScript

You can still use all the vanilla JavaScript features to filter and alter your data - such as `map`, `forEach`, `find`, `filter`, and `reduce`.

```javascript
// source : https://medium.com/@jeff_long/understanding-foreach-map-filter-and-find-in-javascript-f91da93b9f2c

mylist=
  [
    {
      name:'Bob',
      age: 5
    },
    {
      name:'Tom',
      age: 10
    },     
    {
      name:'Paul',
      age: 30
    },    
    {
      name:'Tom',
      age: 40
    }                                                  
  ]

// simple filter
$(mylist).filter((x) => x.age<=20) // filter age<=20
/* result:
[
  {name:'Bob',age:5},
  {name:'Tom',age:10}
]
*/

// filter and addition
$(mylist)
  .filter((x) => x.age<=20)   // filter age<=20
  .map((x) => { return {...x,diff:20-x.age} }) // add new property diff
/* result:
[
  {name:'Bob',age:5,diff:15},
  {name:'Tom',age:10,diff:10}
] 
*/

// find
$(mylist).find((x) => x.name=='Tom').age  // find age of first Tom
// result: 10

// make sum with reduce
$(mylist).reduce((sum,x) => sum+x.age,0) // calculate sum of ages
// result: 85

// make temp function
((arr,min)=>{
  return arr
    .filter(x => x.age>=min)  // filter
    .map(x => {
      var preview=`${x.name} (${x.age})`; // make preview string
      return {...x,preview:preview} })    // add new preview property
})($(mylist),20)                          // feed function with mylist and 20       
/* result:
[
  {name:'Paul',age:30,preview:'Paul (30)'},
  {name:'Tom',age:40,preview:'Tom (40)'}
] 
*/
```

---

## Remote Expressions

The following examples run with the field property `runLocal: false` (default).  
They are evaluated on the server side.

Due to the danger of evaluating code server-side, the expression is sanitized and limited to predefined functions that come with AnsibleForms.  
Server-side expressions are meant to grab information from various datasources, such as files, REST APIs, SSH commands, and more.

{: .important }
All server-side functions are prefixed with `fn.` (e.g., `fn.fnRestBasic`)

### Manipulate Date and Time

```javascript
fn.fnTime().diff(fn.fnTime('2019-10-01'),'day') // number of days between now and 2019-10-01

// This is the core implementation of https://day.js.org
```

### Get CIDR Info from IP

```javascript
fn.fnCidr('172.16.0.1','255.255.0.0')

// fn.fnCidr(ip,netmask)
// - ip : an ip address
// - netmask : a netmask
//  
// it will return the Cidr subnet information as well as expose a `contains` method to check whether an ip is part of this subnet.
// {
//   "networkAddress":"172.16.0.0",
//   "firstAddress":"172.16.0.1",
//   "lastAddress":"172.16.255.254",
//   "broadcastAddress":"172.16.255.255",
//   "subnetMask":"255.255.0.0",
//   "subnetMaskLength":16,
//   "numHosts":65534,
//   "length":65536,
//   "contains":(ip)=>{return ...}
// }
```

### Get SSH Output

```javascript
fn.fnSsh('root','172.16.0.1','ls -la')

// fn.fnSsh(user,host,command,jq-expression)
// - user : the ssh user
// - host : the host
// - command : the command to trigger by ssh
// - jq-expression : an optional jq-expression (https://jsplay.org)  
//  
// You must use 'known_hosts' and 'public-key' to setup non-interactive password-less authentication.
// In the settings you can find the public-key and add your target-host to known_hosts
```

### List Files in a Directory

```javascript
fn.fnLs('/tmp',{ resursive: true, regex: '.*\\.log$', metadata: true })

// fn.fnLs(path,options)
// - path : path to directory
// - options : recursive:boolean, regex:string ,metadata:boolean
//   - recursive : whether to list files recursively
//   - regex : a regular expression to filter files
//   - metadata : whether to include file metadata (size,mtime,... directories will be shown too)
```

### Parse HTML Page

```javascript
fn.fnParseHtmlWithRegex('https://ansibleguy.com','<h2.*?>(.*?)</h2>','g')

// fn.fnParseHtmlWithRegex(url,regex,flags)
// - url : url to html page
// - regex : a regular expression with at least one group ( )
// - flags : regex flags (such as g,i,m)
//
// it will grab the html source and return an array with all the group matches
```

### Get DNS Info

```javascript
fn.fnDnsResolve('ansibleguy.com','A')

// fn.fnDnsResolve(fqdn,type)
// - fqdn : a fully qualified domain name
// - type : the type of dns record (A,AAAA,MX,NS,CNAME,TXT,SRV,PTR)
```

### Read JSON File

```javascript
fn.fnReadJsonFile('/tmp/file.json','.[].name')

// fn.fnReadJsonFile(path,jq-expression)
// - path : path to json file
// - jq-expression : an optional jq-expression (https://jsplay.org)
```

### Read YAML File

```javascript
fn.fnReadYamlFile('/tmp/file.yaml','.[].name')

// fn.fnReadYamlFile(path,jq-expression)
// - path : path to yaml file
// - jq-expression : an optional jq-expression (https://jsplay.org)
```

### REST API with Basic Authentication

```javascript
fn.fnRestBasic(
  'get',
  'https://resturl/api/',
  '',
  'name_of_credential_in_database',
  '[.records[] | {name:.name, email:.email, spouse:.relations.spouse}'],
  'name',
  false
)

// output : a full json object coming from rest, json transformed with jq, result sorted and transformed by javascript.

// fn.fnRestBasic(method,url,body,credentialname,jq-expression,sort-object)
// - method : get,post,put,patch,delete
// - url : url to restapi (can for example contain a placeholder like 'https://$(serverfield.fqdn)/api/'
// - body : in case of post and put
// - credential-name : it will lookup the credentials as you have saved in the gui
// - jq-expression : an optional jq-expression (https://jsplay.org)
// - sort object : a sort object to order the result
// - hasBigInt : a boolean indicating if it should convert Int64 to string
```

### REST API with Token Authentication

```javascript
fn.fnRestJwt(
  'get',
  'https://resturl/api/',
  '',
  'your_jwt_token_in_text',
  '[.records[] | {name:.name, age:.age}]',
  ['age','name'],
  false
)

// output : a full json object coming from rest, json transformed with jq, result sorted, first by age, then by name

// fn.fnRestJwt(method,url,body,token,jq-expression,sort-object)
// - method : get,post,put,patch,delete
// - url : url to restapi (can for example contain a placeholder like 'https://$(serverfield.fqdn)/api/'
// - body : in case of post and put
// - token : it will be add as a Bearer Authorization header
// - jq-expression : an optional jq-expression (https://jsplay.org)
// - sort-object : a sort object to sort the result
// - hasBigInt : a boolean indicating if it should convert Int64 to string
// - tokenPrefix : a prefix, defaults to 'Bearer' (v5.0.0)
```

### REST API with Secured Token Authentication

```javascript
fn.fnRestJwtSecure(
  'get',
  'https://resturl/api/',
  '',
  'name_of_credential_in_database',
  '[.records[] | {name:.name, age:.age}]',
  ['age','name'],
  false
)

// output : a full json object coming from rest, json transformed with jq, result sorted, first by age, then by name

// fn.fnRestJwtSecure(method,url,body,token,jq-expression,sort-object)
// - method : get,post,put,patch,delete
// - url : url to restapi (can for example contain a placeholder like 'https://$(serverfield.fqdn)/api/'
// - body : in case of post and put
// - credential_name : Encrypted credential will be looked up.  The password will be the token.
// - jq-expression : an optional jq-expression (https://jsplay.org)
// - sort-object : a sort object to sort the result   
// - hasBigInt : a boolean indicating if it should convert Int64 to string 
// - tokenPrefix : a prefix, defaults to 'Bearer' (v5.0.0)
```

### REST API with Custom Headers

```javascript
fn.fnRestAdvanced(
  'get',
  'https://resturl/api/',
  '',
  {'a_custom_http_header':'your_value','Authorization':'basic base64(my_rest_credential)'},
  '.records[].name',
  {name:{ignoreCase:true,direction:'desc'}},
  false,
  false
)

// output : a full json object coming from rest, json transformed with jq, result sorted descending by name

// fn.fnRestAdvanced(method,url,body,{myheader:'value'},jq-expression,sort-object)
// - method : get,post,put,patch,delete
// - url : url to restapi (can for example contain a placeholder like 'https://$(serverfield.fqdn)/api/'
// - body : in case of post and put
// - headers: an object of headers
// - jq-expression : an optional jq-expression (https://jsplay.org)
// - sort-object : a sorting object to order the results
// - hasBigInt : a boolean indicating if it should convert Int64 to string
// - raw : return data and response_headers  
  
// 3 function-placeholders are allowed in the headers:
// - base64(credential_name) : will create a base64 encoded "username:password".  prefix with "basic" if required
// - username(credential_name) : will add the username of the credential
// - password(credential_name) : will add the password of the credential
```

### Get Credentials

```javascript
fn.fnCredentials('credentialname_or_regex','fallback_credentialname_or_regex')

// Try to use `fnRestBasic` and `fnRestJwtSecured` if possible, this avoids passwords and tokens going over the network.

// output : a credential object with all properties (username, password, host, port)
```

The exact name is tried first. When no credential has that name, the name is used as a regex, and then the fallback.

#### Credentials from a secret store

A credential that names a [secret store](secret-stores.md) gets its `user` and `password`
from that store at runtime. `fn.fnCredentials('myapp')` keeps working unchanged.

A secret can also be read without a credential row, wherever a credential name is accepted
(including `fnRestBasic`, `fnRestJwtSecure` and the header substitutions of `fnRestAdvanced`):

```javascript
fn.fnCredentials('secret:vault:secret/ontap')   // secret:<store>:<reference>
fn.fnCredentials('vault:secret/ontap')          // the store named `vault`
```

The keys of the secret are mapped as described under [Key names](secret-stores.md#key-names).
A secret with another shape is reshaped with a `jq` expression as the third argument:

```javascript
// secret: { "creds": { "u": "admin", "p": "Netapp12" } }
fn.fnCredentials('vault:secret/weird','','.creds | { user: .u, password: .p }')
```

### Sort an Array

```javascript
fn.fnSort(['a','b','z','q','c'],{'':{direction:'asc'}})

// output : sorts the flat array

// fn.fnSort(arrayinput,sort-object)
// - array, coming from expression or rest or database
// - sort-object : a sorting object to order the results
```

### The Sorting Object

In all the data-fetching functions you have the option to sort your data using this sorting object.

```javascript
// The sorting object can have multiple forms, for example :

'name' // will sort ascending on property name
['name','email'] // will first sort on name, then on email
{name:{direction:'desc'}} // will sort on name descending
{name:{ignoreCase:true}} // will sort on name ascending, ignoring case
['name',{email:{ignoreCase:true,direction:'asc'}}] // will sort on name first, then on email, ignoring case
{'':{}} // a special case for sorting a flat array which has no headername (properties)
{'':{direction:'desc'}} // sort a flat array descending
```

### Run a JSON Query (jq) on an Object

```javascript
fn.fnJq($(settings),'.mapping | keys',{name:{ignoreCase:true,direction:'desc'}})

// output : a full json object taken from another field called "settings", converted by jq, and sorted desc on property "name"

// fn.fnJq(object, jq, sort-object)
// - object, for example read from rest or yaml file
// - jq-expression : an optional jq-expression (https://jsplay.org)
// - sort-object : a sorting object to order the results
```

### Built-in JQ Functions

In all the data-fetching functions you have the option to add a JSON query (jq) - a powerful language to manipulate data objects or arrays.  
While manipulating data, you might need to convert bytes to KB, MB, GB, or round numbers.  
That's why AnsibleForms comes with a few custom handy JQ functions:

- **fn2KB**: Bytes to KB
- **fn2MB**: Bytes to MB
- **fn2GB**: Bytes to GB
- **fnRound0**: Round with 0 decimals
- **fnRound1**: Round with 1 decimal
- **fnRound2**: Round with 2 decimals
- **fnRound**: Round with 2 decimals

```javascript
fn.fnRestBasic('get','https://youruri','','CREDS',
  '[.records[] | {"Available Capacity":.storage_capacity.available | fn2GB | fnRound }]')
// note you need to pipe into the functions
```

### Get a Name with Incremental Numbering

In an array of strings containing incremental numbers (server001, server002, ...), you might want to search for the next available name.  
Also available as local expression (without the `fn.` prefix).

```javascript
fn.fnGetNumberedName(['server001','server002','server005'],'server###','server001',false)
// result : "server006"

fn.fnGetNumberedName(['server001','server002','server005'],'server###','server001',true)
// result : "server003"

fn.fnGetNumberedName($(fieldlist),'server###','server001',true)
// use another expression field as input for the array

// fn.fnGetNumberedName(array,pattern,default,fillgaps)
// This function searches for a numbered pattern in a list of string, 
// increases the highest number and returns a name like the pattern
// - array : an array object, you can use a placeholder to an expression where you know it's an array
// - pattern : a string that hold the # as a digit
// - default : if no value is found, return this default
// - fillgaps : a boolean to indicate it can fill gaps in the numbers, 1,2,3,6 => 4
```
