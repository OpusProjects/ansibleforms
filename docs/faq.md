---
layout: default
title: FAQ
nav_order: 9
---

# Frequently Asked Questions

Common questions and answers about AnsibleForms features and usage.

## Getting Started

### Deployment topology: single instance only

AnsibleForms is designed to run as a **single instance**. Running multiple replicas behind a load balancer is **not supported** today.

**Why:**
- Schema migrations run at startup and assume they are the only writer.
- The scheduler / cron loop is in-process; two instances would fire each scheduled job twice.
- The job runner tracks state in memory and in the DB; concurrent runners can corrupt job state.

**Recommendation:** run a single active instance with restart-on-failure (e.g. `restart: unless-stopped` in Docker / a Kubernetes Deployment with `replicas: 1`), and back up the database plus the persistent volume. If you need true HA, that would require a separate worker service to own migrations, scheduling and job execution — which does not exist yet.

### Multi-Repository Form Management

Use multiple git repositories for forms.

AnsibleForms supports loading forms from multiple git repositories simultaneously. Forms from all repositories with the "Use for forms" switch enabled are automatically merged together.

**How it works:**
- Configure multiple repositories in Settings → Repositories
- Enable the "Use for forms" switch on each repository you want to load forms from
- Each repository can contain a `forms/` directory with form YAML files
- All forms from all repositories are merged together automatically
- Forms with duplicate names will trigger a warning (first one wins)

**Configuration File Discovery:**
- AnsibleForms will use the FIRST config.yaml (or config.yaml) found across all form repositories
- If multiple config files are found, a warning is logged
- You can have a single central config repository for shared categories/roles/constants
- Or use the local `persistent/config.yaml` file (checked if no repository config found)

**Best Practices:**
- Keep config.yaml in only ONE repository or use the local persistent/config.yaml
- Organize forms by team/project using separate repositories
- Use unique form names across all repositories to avoid conflicts
- Repository order matters: forms are loaded in database order

**Example Setup:**

```yaml
Repository 1 (Central Config):
  - config.yaml (categories, roles, constants)

Repository 2 (Network Team):
  - forms/
    - switch_config.yaml
    - router_setup.yaml

Repository 3 (Server Team):
  - forms/
    - server_deploy.yaml
    - backup_restore.yaml
```

All forms appear together in the UI, automatically merged!

### About Repositories

Sometimes you want collaboration and versioning and then git repositories are perfect.  
In version 5.0.0 you can now manage git repositories.  
Every repository is a subfolder of the repositories-path (`REPO_PATH` environment variable).  
Just go to settings / repositories and start managing repositories. You can either add ssh-based repositories (with public key/known hosts) or https based repositories, public or private with username/password/token.

**Since version 6.1.0**, you can add multiple repositories and use specific switches to control what they're used for:

#### Repository Switches (6.1.0+)

- **use for config** - Repository contains config.yaml (categories, roles, constants)
- **use for forms** - Repository contains forms (supports multiple repositories, forms are merged)
- **use for playbooks** - Repository contains Ansible playbooks and roles
- **use for vars files** - Repository contains vars files for forms

#### Repository Structure

Each repository can contain subfolders or files directly in the root:

- **config.yaml** - Placed in repository root (when using "use for config")
- **forms/** subfolder or root - Forms YAML files (when using "use for forms")
- **playbooks/** subfolder or root - Ansible playbooks (when using "use for playbooks")
- **vars/** subfolder or root - Vars files (when using "use for vars files")

If a subfolder doesn't exist, AnsibleForms will fall back to the repository root.

#### Single Repository vs Multiple Repositories

**Single repository approach** (all in one):
- Enable all switches on one repository
- Structure: `config.yaml` in root, `forms/`, `playbooks/`, and `vars/` subfolders

**Multiple repository approach** (separated):
- Use separate repositories for config, forms, playbooks, and vars files
- Each repository can have files directly in root (no subfolders needed)
- Forms can come from multiple repositories (will be merged)

**Important notes:**
- Only ONE repository should have "use for config" enabled (warning if multiple)
- Only ONE repository should have "use for playbooks" enabled (playbooks cannot be merged)
- Only ONE repository should have "use for vars files" enabled
- MULTIPLE repositories can have "use for forms" enabled (forms will be merged)

#### Configuration Priority

Config loading (first match wins):
1. Database (if imported)
2. Repository with "use for config" enabled
3. Repository with "use for forms" enabled (backwards compatibility)
4. Local CONFIG_PATH file

#### Additional Features

You can choose if the repository must be cloned when AnsibleForms starts, and you can add cron-schedule to schedule recurring pull-actions.  
Additionally, in the swagger interface, you will find a clone and pull rest api for webhooks.  
In case you want long-lived access tokens for the webhooks, with swagger you can pass an expiryDays parameter (for admin roles only) and create long-lived tokens.

### VS Code Validation for Form Files

Add a schema header to your form YAML files to get live validation and autocomplete in VS Code.

Install the [YAML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml) and add this comment as the **first line** of any form file:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/ansibleforms/ansibleforms/main/server/schema/public/form_schema.json
```

This works for both single-form files (a YAML dict) and multi-form files (a YAML list):

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/ansibleforms/ansibleforms/main/server/schema/public/form_schema.json
- name: My Form
  type: ansible
  playbook: site.yml
  roles: [public]
  fields:
    - name: env
      type: enum
      values: [dev, staging, prod]
```

VS Code will highlight unknown properties, missing required fields, and wrong types as you type.

## Job Management

### Job Relaunch with Pre-filled Data

Relaunch jobs with form data (v6.0.3).

AnsibleForms supports relaunching jobs with pre-filled form data. When you click the relaunch button in the jobs page, the form will open with all field values from the previous job submission.

**Security Features:**
- Password fields are automatically excluded from storage and retrieval for security
- Raw form data is stored separately from processed extravars (before model transformations)

**Permission Control:**

Forms can prevent relaunch using `allowRelaunch: false`:

```yaml
- name: Production Deployment
  allowRelaunch: false  # Prevents relaunching this form
```

Users must have the `allowJobRelaunch` role option enabled (admins have this by default):

```yaml
roles:
  - name: operators
    options:
      allowJobRelaunch: true  # Allow this role to relaunch jobs
```

**Most Restrictive Logic:** Relaunch is only available if BOTH conditions are met:
1. Form does NOT have `allowRelaunch: false`
2. User role has `allowJobRelaunch: true` (or user is admin)

**How it works:**
- Raw form data is saved to disk on job submission (excluding passwords)
- Clicking relaunch navigates to the form with `?prefillJobId=<id>` parameter
- Form loads with all previous values, respecting field dependencies and async queries
- Users can modify values before resubmitting

### Job Log File

Track progress via a job-specific log file (v6.1.2).

AnsibleForms can display a **job-specific log file** alongside the Ansible output, making it easy to track the progress of long-running custom modules that would otherwise produce no visible feedback during execution.

{: .note }
> This feature only works for direct Ansible jobs. AWX / Ansible Tower jobs are not supported.

**How it works:**
- During a job run, AnsibleForms watches for a log file at a well-known path inside the playbook folder
- When the job is retrieved (or polled), the contents of the log file are read and returned alongside the normal output
- The log file is displayed in a separate **Logfile** panel below the main Ansible output, with full ANSI colour support

**Log file path convention:**

```
<playbook_dir>/.joblogs/job_log_<jobid>.log
```

**AnsibleForms passes `__jobid__` automatically**, so you can assemble the path in your playbook without any extra configuration:

```yaml
job_log_path: "{{ vars['playbook_dir'] }}/.joblogs/job_log_{{ __jobid__ }}.log"
```

Pass this variable to any role or custom module that should write progress to the file.

**Responsibilities of the playbook / module developer:**
- **Create** the log file (and its `.joblogs/` directory) at the start of the operation
- **Write** meaningful progress messages as the operation proceeds
- **Delete** the file when it is no longer needed (e.g. at the start of a new run to avoid stale data)

**ANSI colour coding is supported.**  
You can use standard ANSI escape codes (e.g. `\033[92m` for green, `\033[91m` for red) in your log messages and they will be rendered as colours in the UI. This is ideal for distinguishing success, warning, and error states at a glance.

**Typical use case:**  
A custom Python Ansible module that performs a long sequence of API calls or data operations (e.g. a SnapMirror DR workflow) can append one line per step to the log file. The operator watching the job in AnsibleForms will see live progress in the Logfile panel as each polling cycle refreshes the output.

### Jobid

Pass the current jobid.

Ansible Forms automatically sends the current jobid in the extravars.  
You don't need to do anything.  
It is sent as `__jobid__`.

### Userinfo

Pass the current user.

Ansible Forms automatically sends the userinformation in the extravars.  
You don't need to do anything.  
It is sent as `ansibleforms_user`.

You can choose how much of it is sent.  `EXTRAVARS_USER_FIELDS` takes a comma
separated list of top level keys (`username,email,type`), or `none` to send nothing; a form
can override it with its own `userExtravars` property.  The default is the whole object, as
before.  The form side `__user__` below comes from the login token and is never affected.

### Userinfo Form

Access current user info in the form (v4.0.2).

The field `__user__` is automatically added in the form.

```yaml
expression: $(__user__)
expression: "'$(__user__.username)'"
expression: $(__user__.groups)
expression: $(__user__.roles)
```

## Form Fields

### Cascaded Dropdowns

Make cascaded dropdowns.

`enum` fields (AKA dropdown boxes) can contain placeholders in their `query` or `expression` property in the format of `$(another_field)` or `$(another_field[0].name)`.  
The moment the referenced field changes, the referencing field gets re-evaluated, resulting in dynamic and cascading dropdown boxes.  
The power of this concept lies in the client web-application that is re-evaluating fields every 100ms.  With current processors and the chromium engine, this should be a very seamless experience.

{: .note }
> When you reference another enum field, you reference the selected values, NOT the full dropdown list. Use the `placeholderColumn`-property or a dot-notation like `$(city.name)`.  
> **New in v4.0.20**: setting placeholderColumn to "*" will output the entire record, instead of a single column.

```yaml
- type: enum
  dbConfig: 
    name: CONN1
    type: mysql
  query: select name from cmdb.city
  name: city_name
  label: Select a city
  default: Amsterdam
  required: true
  model: cmdb.city
  group: CMDB
- type: enum
  dbConfig: 
    name: CONN1
    type: mysql
  query: select datacenter.name from cmdb.datacenter,cmdb.city where datacenter.city_id=city.id
    and city.name='$(city_name)'
  name: datacenter_name
  label: Select a datacenter
  default: __auto__    # default can be "__auto__" (first item) or "__all__" (all items) or "__none__" (no default)
  multiple: true
  outputObject: true
  required: true
  model: cmdb.datacenter
  group: CMDB      

# or use the placeholderColumn property

- type: enum
  dbConfig: 
    name: CONN1
    type: mysql
  query: select id,name,description from cmdb.city
  name: city
  label: Select a city
  default: Amsterdam         # evaluated against valueColumn
  required: true
  model: cmdb.city
  group: CMDB
  valueColumn: name          # we choose the name column as value for placeholders
  placeholderColumn: id      # we can reference the id by using $(city)
  previewColumn: description # when you select a value, the dropdown will show description
  columns:                   # we hide id
  - name
  - description
- type: enum
  dbConfig: 
    name: CONN1
    type: mysql
  query: select name, capacity_pct from cmdb.datacenter where datacenter.city_id=$(city)
# this cascaded dropdown will react using "id" as placeholder
# or "query":"select name from cmdb.datacenter where datacenter.city_id=$(city.id)",  
# or reference the column in the placeholder                            
  name: datacenter_name
  label: Select a datacenter
  default: __auto__         # default can be "__auto__" (first item) or "__all__" (all items) or "__none__" (no default)
  multiple: true
  pctColumns
  - capacity_pct
  outputObject: true
  required: true
  model: cmdb.datacenter
  group: CMDB
```

### Field Placeholders

Reference another field's value.

Placeholders are references to other fields in the forms.  
A placeholder is always in the format `$(reference)`. Expressions or queries can contain placeholders.  
If the placeholder is pointing to a simple field (text, number, password), it will hold that field's value.  
If the placeholder is pointing to a object-based-enum field, then you must either use the `placeholderColumn`-property or a dot-notation like `$(city.name)`.  
If the placeholder is pointing to an expression field, then either the full object is returned or you can have an advanced placeholder reference like `$(myarray[0].name)` where you can create javascript-like references.

{: .important }
> Important to know is that the placeholder is replaced BEFORE the evaluation of the expression. If you expect the result to be a string, then you must wrap it with quotes!  
> **New in v4.0.20**: setting placeholderColumn to "*" will output the entire record, instead of a single column.

```yaml
- name: field1
  type: expression
  expression: "[{name: 'foo'},{name: 'bar'},{name: 'ansible'}]"
  runLocal: true
- name: field2
  type: expression
  expression: "'$(field1[0].name)'"  # result : 'foo' (note the wrapping quotes)
  runLocal: true
- name: field3
  type: expression
  expression: "$(field1)[0].name"  # result : {name: 'foo'}.name => 'foo'  
  runLocal: true    
- name: field4
  type: expression
  expression: "$(field1).slice(-1)[0].name"  # result : {name: 'ansible'}.name => 'ansible' 
  runLocal: true
- name: field5
  type: enum
  expression: $(field1).filter(x => x.name.includes('a'))   # result : [{name: 'bar'},{name: 'ansible'}]
  runLocal: true
  default: __auto__                                         # result: bar
- name: field6
  type: expression
  expression: "'$(field5)'"   # result : the selected item from field5 (default=bar)
  runLocal: true        
```

### Hide a Field

Hide a field.

You can hide a field using the field property `hide`.  
Or you can show/hide a field dynamically using the field properties `dependencies` and `dependencyFn`.

### Group Fields

Group fields together in a block.

Use the field property `group`. Fields with the same group name will be grouped in a block.

### Field Validation

Validate a field.

Have a look at the many validation field properties such as `regex`, `minValue`, `notIn`, ...

### Default Value on Enum

Enum default value.

There is obviously the field property `default` you can use to manipulate a default.  
And with `enum` fields, you can use `__auto__` for example to automatically select the first item.  

But sometimes you want to have a dynamic default, based on an expression.  
See the below example how we accomplish this.

```yaml
# using client javascript manipulation

- type: expression
  expression: "[{name:'bert'},{name:'ernie'},{name:'pino'}]"
  name: dropdownsource
  label: Dropdown source
  runLocal: true
- type: expression
  expression: "'pino'"
  name: dropdownsourceDefault
  label: Default source
  runLocal: true
- type: enum
  expression: "[...[{name:'$(dropdownsourceDefault)'}],...$(dropdownsource).filter(x => x.name!=='$(dropdownsourceDefault)')]"
  name: dropdownwithdefault
  label: Example with expression default by moving it to top
  runLocal: true
  default: __auto__     

# explained : 
# we take our default and merge it with the source where we filter out the default (to avoid doubles)    
# the default is thus shifted to the first element, which we can now select with the default `__auto__`
```

### Expression Default Value

Expression default value.

For text, number or date fields, you can use the `default` property to set a default value.  
But what if you want this to be dynamic? Like an expression?  

You can do this in 2 ways:  
* `editable`: use the editable property to make an expression-field editable
* `evalDefault`: use the evalDefault property to evaluate the default as an expression

```yaml
# using editable
- type: expression
  expression: "'$(some_other_field)'.toLowerCase()"
  name: field1
  runLocal: true
  editable: true # this will add an edit-button so you manually overwrite the expression value

# using evalDefault
- type: text
  name: field1
  default: "'$(some_other_field)'.toLowerCase()"
  evalDefault: true # it will treat the default as if it was an expression.
  # note : when `some_other_field` changes, the default will be re-evaluated
  # note2 : works for other fields too.

# more complex evalDefault example
- name: checkbox
  type: checkbox
- name: textfield1
  type: text
  line: line2
  default: ping
- name: textfield2
  type: text
  line: line2
  default: pong
- name: checkbox3
  type: checkbox
  line: line3
  label: This checkbox will default check if checkbox or textfield1==textfield2
  default: |
    (
      (c=false,t1="",t2="") => { return c || (t1==t2) }
    )( $(checkbox) , "$(textfield1)" , "$(textfield2)" )
    
  evalDefault: true
```

## Wizard & Multistep

### What is the difference between a wizard and a multistep form?

A **wizard** and a **multistep** form sound similar but operate on different layers — and they can be combined.

| | [`steps`](forms/multistep.html) (Multistep) | [`wizard`](forms/wizard.html) |
|---|---|---|
| **Layer** | Execution | Form / UI |
| **What it splits** | The job into multiple sequential runs | The input of one form into multiple pages |
| **Result** | N jobs run, one after the other (each with its own playbook/template) | 1 job runs at the end |
| **Form `type`** | Must be `multistep` | Works with `ansible`, `awx` and `multistep` |
| **Defined by** | A list of execution targets (`steps:`) | A list of [subform](forms/subform.html) references (`wizard:`) |
| **Use it when** | "Do A, then B, then C as separate jobs" | "My form has too many fields for one page" |

**Key takeaway:** `steps` is about *what runs and in which order*; `wizard` is about *how the user fills in the form*.

#### Multistep only

A `type: multistep` form runs one playbook/template per step. The user fills a single page of fields, presses Submit, and the executor runs each step sequentially:

```yaml
- name: Provision host
  type: multistep
  steps:
    - name: Create host
      type: ansible
      playbook: create_host.yml
    - name: Verify host
      type: ansible
      playbook: verify_host.yml
  fields:
    - name: hostname
      type: text
```

#### Wizard only

A `wizard:` block on an `ansible` (or `awx`) form turns input collection into a multi-page experience. Only **one** job runs at the end — the merged extravars from all pages are sent to a single playbook/template:

```yaml
- name: Provision host
  type: ansible
  playbook: provision.yml
  wizard:
    - subform: basics
      title: Basics
    - subform: network
      title: Network
      defaultModel: net

- name: basics
  type: subform
  fields:
    - name: hostname
      type: text
      required: true

- name: network
  type: subform
  fields:
    - name: ipv4
      type: text
```

A read-only review page is appended automatically as the last wizard page — you do not declare it in YAML.

#### Combined (wizard on top of multistep)

A wizard can be layered on top of a multistep form. The user fills the wizard pages, presses Submit, and **then** the multistep execution kicks off. By matching a wizard step's `defaultModel` with a multistep step's [`key`](forms/multistep.html#step_key), you can route **one wizard page to one multistep step**:

```yaml
- name: Provision and verify host
  type: multistep
  wizard:
    - subform: basics
      title: Basics
      defaultModel: basics            # wraps basics fields under `basics`
    - subform: network
      title: Network
      defaultModel: network           # wraps network fields under `network`
  steps:
    - name: Create host
      type: ansible
      playbook: create_host.yml
      key: basics                     # only sees the basics page payload
    - name: Configure network
      type: ansible
      playbook: configure_network.yml
      key: network                    # only sees the network page payload
```

`key` is a single-level lookup, so use a flat name in `defaultModel` (e.g. `defaultModel: basics`, not `defaultModel: input.basics`) when you want them to match.

See the [Wizard page](forms/wizard.html) for the full property reference.

### How do I conditionally show or skip wizard steps?

Use `when:` to **hide** a step entirely, or `optional: true` to allow the user to **skip** a visible step. They are independent and should generally not be combined.

#### `when:` — conditional visibility

The step is hidden when the expression evaluates falsy. The user never sees it and its values are not collected. The expression can read earlier steps via `__parent__.<stepname>.<field>`:

```yaml
wizard:
  - subform: basics             # has a `kind` enum field with values vm/bare-metal/container
    title: Basics
  - subform: virtualization
    title: Virtualization
    when: $(__parent__.basics.kind) === 'vm'
  - subform: hardware
    title: Hardware
    when: $(__parent__.basics.kind) === 'bare-metal'
```

Only the page matching the chosen `kind` is shown. Steps after a hidden one are renumbered automatically.

#### `optional: true` — allow skipping a visible step

The step is **always shown** in the stepper, but the user can press **Next** without filling it in, and **Submit** is allowed even if the page was never visited or completed:

```yaml
wizard:
  - subform: basics
    title: Basics
  - subform: advanced
    title: Advanced (optional)
    optional: true
```

The user can land on the Advanced page, fill nothing, hit Next, and proceed straight to the review page.

{: .note }
> `when:` is about *visibility*; `optional:` is about *whether the page is required to complete*. Don't combine them — if you want a page to disappear, use `when:`; if you want it visible-but-skippable, use `optional:`.

### How do I reference values from an earlier wizard step?

Use `$(__parent__.<stepname>.<field>)` inside any field of a later step.

The `name` of a wizard step (defaults to its `subform` name) is the namespace under which its values are exposed to later steps:

```yaml
wizard:
  - subform: basics            # step name defaults to "basics"
    title: Basics
  - subform: network
    title: Network

- name: basics
  type: subform
  fields:
    - name: hostname
      type: text
      required: true

- name: network
  type: subform
  fields:
    - name: fqdn
      type: text
      # Re-evaluated when basics.hostname changes
      default: $(__parent__.basics.hostname).local
```

This is the same `__parent__` mechanism used by `list` and `yaml` subforms — see [How do I access parent form data inside a subform?](#how-do-i-access-parent-form-data-inside-a-subform).

## Security & Credentials

### Credentials

Pass credentials.

Credentials can be add in several ways:
* using the field-property `asCredential`  
* using the `credentials` form-property (key-value pairs)
* using an extravar called `__credentials__`

```yaml
# assume you have 2 credentials created in Ansible Forms
# 1: vcenter
# 2: ad

# you want them exposed to the playbook as
# 1: vc_cred
# 2: ad_cred

# Method 1 : using asCredential field-property
fields:
- name: vc_cred
  type: expression
  runLocal: true
  expression: "'vcenter'"
- name: ad_cred
  type: expression
  runLocal: true
  expression: "'ad'"

# Method 2 : using credentials form-property   
name: myplaybook
type: ansible
credentials:
  vc_cred: vcenter
  ad_cred: ad
  veeam_cred : veeam_prod,veeam_dev # will first try veeam_prod, then as fallback veeam_dev

# Method 3 : using __credentials__ extravar
fields:
- name: __credentials__
  type: expression
  runLocal: true
  expression: "{vc_cred: 'vcenter',ad_cred: 'ad',veeam_cred:'$(veeam_server)'}"
  # note : in the expression you can use placeholders to make them dynamic
```

### Recovering a lost admin password

If you've lost the password for the local `admin` account (and you don't have any other admin user available), you can use the `REINIT_ADMIN` recovery hatch. **This is not a runtime auth bypass** — it only forces a one-time reset of the local admin account at startup, then lets normal authentication proceed.

**How it works**

When `REINIT_ADMIN=1` is set at startup, AnsibleForms will:

1. Ensure the `admins` group exists (creating it if missing).
2. Look up the local admin user (default username `admin`, override via `ADMIN_USERNAME`).
3. If it exists, reset its password to the value of `ADMIN_PASSWORD` and re-attach it to the `admins` group.
4. If it doesn't exist, create it (same as a fresh install).
5. Log the action loudly so it shows up in your logs.

**Steps**

1. Stop AnsibleForms.
2. Set the env vars (use a strong password):
   ```bash
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=YourNewStrongPasswordHere
   REINIT_ADMIN=1
   ```
   In Docker Compose, add them to the `environment:` block of the AnsibleForms service.
3. Start AnsibleForms. Watch the logs for a line like:
   ```
   REINIT_ADMIN: admin user 'admin' has been recreated. UNSET REINIT_ADMIN now.
   ```
4. Log in with `admin` / `YourNewStrongPasswordHere`.
5. **Unset `REINIT_ADMIN` (or set it back to `0`)** and restart so accidental future restarts don't keep resetting the admin password.

**Notes**

- If you were locked out because LDAP was the only configured login method and broke, the recovered local `admin` account always falls back to local DB auth — that's enough to get back in and fix LDAP.
- The previous `ENABLE_BYPASS` env var is gone. It allowed login as admin with any password and was unsafe to leave enabled. `REINIT_ADMIN` only resets the password and stops there; normal auth runs after that.
- Existing sessions and tokens are not invalidated by `REINIT_ADMIN` — only the password hash and group membership are changed.

### Restricting REST helper destinations (allow/deny lists)

The `fn.fnRestBasic`, `fn.fnRestAdvanced`, `fn.fnRestJwt` and `fn.fnRestNtlm` helpers can be called from form `expression` properties to fetch data over HTTP. By default, expression authors can target **any** URL the AnsibleForms host can reach. On a sensitive network you may want to limit this.

Two environment variables provide allow- and deny-lists:

| Variable | Behaviour |
|---|---|
| `REST_ALLOWED_HOSTS` | Comma-separated hostnames or CIDRs. When set, **only** these targets are allowed. |
| `REST_DENIED_HOSTS` | Comma-separated hostnames or CIDRs. Always blocked. Wins over the allow-list. |

Hostnames are matched case-insensitively against the URL host. CIDRs are matched against every IP the host resolves to, so `10.0.0.0/8` blocks any DNS name that resolves into the private range.

**Examples:**

```bash
# Whitelist: only your two API partners are reachable
REST_ALLOWED_HOSTS=api.example.com,partner.api.com

# Blacklist: block cloud metadata + internal admin UIs
REST_DENIED_HOSTS=169.254.169.254,127.0.0.0/8,internal-admin.example
```

{: .warning }
> **This guard only protects the AnsibleForms Node.js process.** Once a playbook runs, Ansible itself can reach anything from the host — outside AF's control. Use these lists to stop form authors from turning expressions into a metadata-service / internal-UI proxy; do not rely on them as a network firewall.

### HashiCorp Vault Integration

Credentials can read their user and password from HashiCorp Vault, configured as a
**secret store**. See [Secret stores](secret-stores.md). The `VAULT_*` environment variables
of earlier versions are imported once as the store `vault` at the first 7.x start.

For secrets used only inside one playbook you can also use the `community.hashi_vault`
lookup plugin, which reads from Vault directly and bypasses AnsibleForms.

## Integration

### Query AWX/Tower/AAP

Query information from AWX or Ansible Automation Platform.

Sometimes you want to create dropdown boxes, with data from AWX or Tower.  
You can use `fn.fnRestBasic` or `fn.fnRestJwtSecure` to query to do this.

```yaml
name: Query awx
type: awx
awx: myAwxConfigName
template: my_template # will be overwritten by the field __template__
description: ""
awxCredentials:
  - vmware
executionEnvironment: my_execution_environment
roles:
  - public
categories: []
inventory: my_inventory # will be overwritten by the field __inventory__
tileClass: bg-info-subtle
icon: bullseye
fields:
  # make sure you add credentials called "awx_rest" where the password holds the token
  # if you like basic authentication, switch the expressions below to fn.fnRestBasic instead

  - name: organization
    label: Organization
    type: enum
    default: __auto__
    expression: "fn.fnRestJwtSecure('get','https://172.16.50.1/api/v2/organizations','','awx_rest','[.results[]]')"
    columns:
      - name
    valueColumn: id # => we want the organisation field to hold the id !!
  - name: __template__  # use this special name to override the template from the form
    label: Inventory
    type: enum
    default: __auto__
    expression: "fn.fnRestJwtSecure('get','https://172.16.50.1/api/v2/job_templates?organization=$(organization)','','awx_rest','[.results[]]')"
    columns:
      - name
    valueColumn: name
  - name: __inventory__  # use this special name to override the inventory from the form
    label: Inventory
    type: enum
    default: __auto__
    expression: "fn.fnRestJwtSecure('get','https://172.16.50.1/api/v2/inventories?organization=$(organization)','','awx_rest','[.results[]]')"
    columns:
      - name
    valueColumn: name    
  - name: __awxCredentials__  # use this special name to override the credentials from the form
    label: Inventory
    type: enum
    expression: "fn.fnRestJwtSecure('get','https://172.16.50.1/api/v2/credentials?organization=$(organization)','','awx_rest','[.results[]]')"
    multiple: true
    default: __auto__
    columns:
      - name
    valueColumn: name     
  - name: __executionEnvironment__  # use this special name to override the executionEnvironment from the form
    label: Inventory
    type: enum
    expression: "fn.fnRestJwtSecure('get','https://172.16.50.1/api/v2/execution_environments?organization=$(organization)','','awx_rest','[.results[]]')"
    default: __auto__
    columns:
      - name
    valueColumn: name           
```

## Customization

### Customization

Customize Ansible Forms.

Ansible Forms is a web-app. If you run it natively in nodejs, you could replace files or change them.  
But more recommended is to run it as a docker-image and add volume or file mappings. Our docker-compose projects already maps directories to make the database, playbooks, logs, certificates and ssh-keys persistent. Nothing is keeping you from adding more mappings to, for example, override the logo.  
There is also a `custom.js` file where you can add your own javascript functions to use in expressions. Just like you can address our functions with the prefix `fn.` (fn.fnRestBasic for example) you can access the custom functions with prefix `fnc.`.  
And you can add your own jq definitions as well in the same way with the `jq.custom.definitions.js`

```yaml
volumes:
  # Mount application folder to host folder (to maintain persistency)
  - ./data:/app/dist/persistent
  # Map custom functions for js expressions and jq
  - ./data/functions/custom.js:/app/dist/src/functions/custom.js
  - ./data/functions/jq.custom.definitions.js:/app/dist/src/functions/jq.custom.definitions.js
  # Map custom sshkey to local node .ssh location
  - ./data/ssh:$HOME_DIR/.ssh
  - ./data/git/.gitconfig:$HOME_DIR/.gitconfig    
  # Map custom logo
  - ./data/mylogo.svg:/app/dist/views/assets/img/logo_ansible_forms_full_white.svg
```

### Enable YTT

Enable ytt.

In the case you want to use ytt, it can be enabled by setting `USE_YTT=1`.  
Read more info about ytt (https://carvel.dev/ytt/).

{: .important }  
> This feature has not been heavily tested and was added as an enhancement with no feedback after it was added.  
> When using ytt, you must disable the designer, the designer will convert the yaml files to intermediate json and will drop the ytt syntax (which is yaml comments).

A `lib` directory needs to exist within the root directory and is automatically included for the ytt call.
Data can be provided globally by setting prefixed environment variables:  

```bash
YTT_VARS_PREFIX=YTT_VAR
YTT_VAR_INVENTORY_PATH=/tmp/inventory.yml
YTT_VAR_default_host=localhost
```  

Or by providing library data files:

```bash
YTT_LIB_DATA_DEMO=/tmp/demo_data.yml
```  

```yaml
# /tmp/demo_data.yml
message: 'hello demo'
```

**The library `demo` needs to exists in the ytt context (lib/_ytt_lib/demo/values.yml)**

```yaml
# lib/_ytt_lib/demo/values.yml
#@ data/values
---
demo: {}
```  

Then, the loaded data can be used:

```yaml
# config.yaml
#@ load("@ytt:data", "data")
#@ load("@ytt:library", "library")
#@ demo = library.get("demo")
---
categories:
  - name: Default
    icon: bars
roles:
  - name: admin
    groups:
      - local/admins
constants:
  data_values: #@ data.values
  demo: #@ demo.data_values()
```

## Access Control

### How do I restrict what users can do (role options)?

Control per-role UI permissions with role options.

Beyond restricting which forms a role can see, AnsibleForms has a set of **role options** that give finer control over what users of a role can do in the UI. Options are additive — admins always have full access.

See the full option reference in [config.yaml → Role options](config.html#role-options).

Common examples:

```yaml
roles:
  - name: operators
    options:
      showLogs: true          # can view job history and output
      allowJobRelaunch: true  # can relaunch previous jobs
      allowVerboseMode: true  # can enable verbose output on a run
  - name: designers
    options:
      showDesigner: true      # can open the YAML designer
      showSettings: false     # cannot access settings
  - name: schedulers
    options:
      allowJobScheduling: true  # can schedule forms
      allowJobStoring: true     # can save and load form data
```

{: .note }
> Most role options have a default (many default to `true`). If an option is explicitly set on a role it is always used. If it is not set, admins are allowed; non-admins fall back to the option's default value.

### How do I implement custom RBAC logic in my playbooks or forms?

User identity is available in both the frontend and backend at every execution.

At every form submission AnsibleForms automatically injects the current user's full identity into the extravars sent to Ansible:

```yaml
ansibleforms_user:
  username: jane.doe
  groups:
    - local/admins
    - ldap/network-team
  roles:
    - admin
    - operators
  options:
    showLogs: true
    allowJobRelaunch: true
    # ...all resolved role options
```

This means your playbook or any custom Ansible module can use `ansibleforms_user` directly to make fine-grained decisions — for example, only allowing certain groups to modify production inventory, or writing an audit trail with the submitter's username.

In the **frontend**, the same object is available via the special `__user__` field:

```yaml
fields:
  - name: is_admin
    type: expression
    runLocal: true
    hide: true
    expression: "$(__user__.roles).includes('admin')"

  - name: target_env
    type: enum
    values:
      - dev
      - staging
      - production
    # hide the production option for non-admins by cross-referencing __user__
    expression: |
      $(__user__.roles).includes('admin')
        ? ['dev','staging','production']
        : ['dev','staging']
    runLocal: true
    default: __auto__
```

**Typical patterns:**

- **Cross-reference an RBAC config file or database** — load a YAML/JSON file (via `fn.fnReadYamlFile` or an expression) that maps groups to allowed resources, then filter based on `$(__user__.groups)`
- **Audit trail** — pass `ansibleforms_user.username` as an extra variable to write who triggered the job
- **Dynamic field values** — show a different set of enum choices, pre-fill fields, or hide sections based on the user's groups or roles
- **Playbook-side authorization** — assert that `ansibleforms_user.groups` contains a required group before the playbook proceeds, as a defence-in-depth check independent of the form's `roles` list

{: .note }
> The object above is what is sent by default. If the instance sets `EXTRAVARS_USER_FIELDS`,
> or the form sets `userExtravars`, only the keys named there are sent — so a playbook that
> asserts on `ansibleforms_user.groups` needs `groups` to be one of them. The frontend
> `__user__` field comes from the login token and is never trimmed by either setting.

## Job Scheduling

### How do I schedule a form to run automatically?

Run forms on a schedule or at a future time (v6.1.5).

AnsibleForms supports two scheduling modes via the job scheduling feature:

- **Cron schedule** — submit the form and it will run repeatedly on a cron expression (e.g. every night at 2 AM)
- **One-off / run later** — submit the form to run once at a specific future date and time

**Requirements:**
- The user's role must have `allowJobScheduling: true`
- The form must not have `allowRelaunch: false` (scheduling uses the same pre-fill mechanism)

**How it works:**
1. Open a form and fill in the values
2. Instead of clicking **Submit**, click **Schedule**
3. Choose a cron expression or a specific date/time
4. The job appears in the job list with a scheduled status and runs automatically at the configured time

Scheduled jobs can be viewed, edited, and cancelled from the job history page.

## Save & Load Form Data

### How do I save and reload form data without running a job?

Store form submissions for later use (v6.1.5).

The **Store** and **Load from store** actions let you save a snapshot of form field values to disk and reload them later — without triggering a job run. This is useful for saving complex configurations you want to reuse across multiple submissions.

**Requirements:**
- The user's role must have `allowJobStoring: true`

**How it works:**
1. Fill in the form
2. Click **Store** — the current field values are saved under a name you choose
3. Later, open the same form and click **Load from store** to restore the saved values
4. Review / adjust and submit as usual

{: .note }
> Password fields are never stored. Stored data is tied to the form name — loading from a different form will not work.

## Nested Forms & Structured Fields

### How do I collect structured or repeated data in a form?

Use `list` and `yaml` fields with subforms (6.2.0+).

For collecting complex structured data — like a list of servers, a set of network interfaces, or a single nested object — use the `list` or `yaml` field types together with a `subform`.

A **subform** is a reusable form fragment (defined with `type: subform`) that is never shown as a standalone tile. It exists solely to be referenced by fields in other forms. See the [Subform docs](forms/subform.html) for full reference.

**Collecting a list of structured rows — `list` field:**

```yaml
forms:
  - name: Server
    type: subform
    fields:
      - name: hostname
        type: text
        required: true
      - name: ip
        type: text
        regex: ^\d+\.\d+\.\d+\.\d+$

  - name: Deploy to servers
    type: ansible
    playbook: deploy.yml
    fields:
      - name: servers
        type: list
        subform: Server   # opens Server subform in a drilldown editor per row
```

The `servers` extravar sent to Ansible will be an array of objects: `[{hostname: "web1", ip: "10.0.0.1"}, ...]`

**Editing a single structured object — `yaml` field:**

The `yaml` field has three modes:

| Mode | How | Behaviour |
|---|---|---|
| **Editor** | default | Shows a full YAML syntax-highlighted editor the user can type in directly |
| **Readonly** | `readonly: true` | Renders the YAML value as formatted read-only text — no editing |
| **Subform** | `subform: MySubform` | Hides the raw editor; opens the subform as a drilldown editor on click |

```yaml
fields:
  # editor mode (default)
  - name: raw_config
    type: yaml

  # readonly mode
  - name: generated_config
    type: yaml
    readonly: true

  # subform mode
  - name: network_config
    type: yaml
    subform: NetworkConfig   # opens NetworkConfig subform as a drilldown editor
```

**Upload and download — `list` and `yaml` fields:**

Both field types support client-side file transfer via two optional properties:

```yaml
fields:
  - name: servers
    type: list
    subform: Server
    showLoadButton: true      # shows an Upload button — imports content from a local file
    showDownloadButton: true  # shows a Download button — exports current content to a file

  - name: config
    type: yaml
    showLoadButton: true
    showDownloadButton: true
```

{: .note }
> The `list` field and the `subform` form type replaced the `table` field and `tableFields`, which were removed in 7.0.0.

### How do I access parent form data inside a subform?

Reference parent field values from within a subform via `__parent__` (v6.3.0+).

When a subform opens — whether triggered by a **`list`** field (each row editor) or a **`yaml`** field in subform mode — AnsibleForms automatically injects a special read-only field called `__parent__` into the subform. It contains a snapshot of **every field value in the parent form at the time the subform was opened**, including constants and vars.

This lets subform fields use expressions that reference parent data without any extra configuration.

#### What is in `__parent__`?

`__parent__` is a plain object whose keys are the field names of the parent form:

```yaml
__parent__:
  environment: production          # a regular field
  region: eu-west-1
  max_nodes: 10
  owner: jane.doe                  # a constant
  default_image: ubuntu-22.04      # from varsFiles
  __user__:                        # system fields are also included
    username: jane.doe
    roles: [admin]
```

{: .note }
> `__parent__` is **not sent to Ansible** — it is stripped from extravars just like `__user__`. It is purely a frontend helper for expressions inside subforms.

#### Accessing parent values in subform expressions

Use the standard `$(...)` expression syntax:

```yaml
forms:
  - name: NodeConfig
    type: subform
    fields:
      - name: node_name
        type: text
        label: Node name
        required: true

      - name: image
        type: enum
        label: Image
        # default to the parent form's chosen image
        expression: "'$(__parent__.default_image)'"
        runLocal: true

      - name: is_production
        type: expression
        hide: true
        runLocal: true
        expression: "'$(__parent__.environment)' === 'production'"

      - name: node_type
        type: enum
        values:
          - standard
          - high-memory
          - gpu
        # only offer gpu nodes in production
        expression: |
          '$(__parent__.environment)' === 'production'
            ? ['standard', 'high-memory', 'gpu']
            : ['standard', 'high-memory']
        runLocal: true
        default: __auto__

  - name: Deploy cluster
    type: ansible
    playbook: deploy_cluster.yml
    fields:
      - name: environment
        type: enum
        values: [dev, staging, production]

      - name: default_image
        type: text
        default: ubuntu-22.04

      - name: nodes
        type: list
        subform: NodeConfig
        columns: [node_name, node_type]
```

#### Nested subforms

`__parent__` always refers to the **immediate parent** form. If you nest a `list` inside a subform that is itself opened from a parent form, the inner subform's `__parent__` will be the middle subform's data. Chain multiple levels by referencing `$(__parent__.__parent__.someField)` if the middle subform also propagates its own `__parent__`.

### How do I migrate from `table` / `tableFields` to `list` / `subform`?

The `table` field and the `tableFields` property were deprecated in 6.2.0 and removed in 7.0.0. A form that still uses them fails validation. To migrate:

1. Extract the columns from `tableFields` into a new `type: subform` form with regular `formfields`
2. Replace the `table` field with a `list` field that references the subform via `subform: MySubformName`

**Before:**
```yaml
forms:
  - name: Manage users
    type: ansible
    playbook: users.yml
    fields:
      - name: users
        type: table
        tableFields:
          - name: username
            type: text
          - name: email
            type: text
```

**After:**
```yaml
forms:
  - name: User
    type: subform
    fields:
      - name: username
        type: text
      - name: email
        type: text

  - name: Manage users
    type: ansible
    playbook: users.yml
    fields:
      - name: users
        type: list
        subform: User
```

#### Migrating `from` in `tableFields` to `__parent__` expressions

The `from` property available in `tableFields` enum columns let you populate dropdown choices from another field in the parent form. In a `subform`, this is replaced by an `expression` that reads the same value via `__parent__`.

**Before — `tableFields` with `from`:**

```yaml
forms:
  - name: Manage members
    type: ansible
    playbook: members.yml
    fields:
      - name: available_departments
        type: expression
        expression: "['HR','Engineering','Finance']"
        runLocal: true
        hide: true

      - name: members
        type: table
        tableFields:
          - name: department
            type: enum
            from: available_departments   # pulls choices from the parent field above
          - name: firstname
            type: text
```

**After — subform with `__parent__` expression:**

```yaml
forms:
  - name: Member
    type: subform
    fields:
      - name: department
        type: enum
        # replaces "from: available_departments"
        expression: "$(__parent__.available_departments)"
        runLocal: true

      - name: firstname
        type: text

  - name: Manage members
    type: ansible
    playbook: members.yml
    fields:
      - name: available_departments
        type: expression
        expression: "['HR','Engineering','Finance']"
        runLocal: true
        hide: true

      - name: members
        type: list
        subform: Member
```

{: .note }
> `$(__parent__.available_departments)` returns the **current value** of that field — so if it is a dynamic expression field itself, the subform will always see the latest evaluated result from the parent.

