// Placeholder substitution into an EXPRESSION (Helpers.substituteExpressionPlaceholder,
// used by AppForm's replacePlaceholderInString in 'expression' mode).
//
// An expression is JS source, so a value cannot simply be pasted in: it has to be written
// the way the position it lands in requires. Every failure here is silent - the result is
// still syntactically valid JS, it just means something else - so each case below is one
// that has been, or would be, wrong in a way nothing else catches:
//
//   - a placeholder inside a longer string got a JS literal, so its quotes ended up in the
//     middle of the string : fn.fnReadYamlFile('$(BASEDIR)/playbooks/vars/clusters.yml')
//     resolved to '"/app/dist/persistent"/playbooks/...' and ENOENT'd on every path and
//     url built that way (the documented AWX examples in https://ansibleforms.com/faq are all this shape)
//   - a quoted placeholder must take the quotes WITH it, or a value carrying an apostrophe
//     closes the string early and the rest of it is read as code
//   - a bare placeholder must stay a JS literal, or `$(count) + 1` concatenates
//   - the value is never a replacement pattern : $& , $1 and friends must be inserted
//     verbatim, not re-interpreted against the match
import { describe, it, expect } from 'vitest';
import Helpers from '@/lib/Helpers';

const sub = (expression, placeholder, value, isSource = false) =>
  Helpers.substituteExpressionPlaceholder(expression, placeholder, value, isSource);

// What the expression evaluates to once substituted. eval is what the real thing does with
// it (server side, or in the sandbox for runLocal), so the assertions are about the VALUE
// the form ends up with, not about the text. `fn` stands in for the function library and is
// reached by name from inside eval, exactly as expression.model.js resolves it.
const evaluate = (expression) => {
  // eslint-disable-next-line no-unused-vars -- referenced by name from the eval'd expression
  const fn = {
    echo: (v) => v,
    upper: (v) => String(v).toUpperCase(),
    fnLs: (p) => p,
    fnReadYamlFile: (p) => p,
    fnRestBasic: (url, method) => `${method}:${url}`,
    fnJq: (o) => o,
  };
  return eval(expression);
};

describe('a placeholder inside a longer string', () => {
  it('does not inject quotes into the string', () => {
    const out = sub("fn.fnReadYamlFile('$(BASEDIR)/playbooks/vars/clusters.yml')",
      '$(BASEDIR)', '/app/dist/persistent');
    expect(out).toBe("fn.fnReadYamlFile('/app/dist/persistent/playbooks/vars/clusters.yml')");
    expect(evaluate(out)).toBe('/app/dist/persistent/playbooks/vars/clusters.yml');
  });

  it('works the same in a double quoted string', () => {
    const out = sub('fn.fnLs("$(dir)/sub")', '$(dir)', '/data');
    expect(out).toBe('fn.fnLs("/data/sub")');
  });

  it('keeps a url query intact', () => {
    // https://ansibleforms.com/faq : fn.fnRestJwtSecure('get','https://.../job_templates?organization=$(organization)',...)
    const out = sub("'https://awx/api/v2/job_templates?organization=$(organization)'",
      '$(organization)', 'my org');
    expect(evaluate(out)).toBe('https://awx/api/v2/job_templates?organization=my org');
  });

  it('escapes the enclosing quote so the value cannot end the string', () => {
    const out = sub("fn.upper('hello $(name)')", '$(name)', "O'Brien");
    expect(evaluate(out)).toBe("HELLO O'BRIEN");
  });

  it('escapes a backslash rather than starting an escape sequence', () => {
    const out = sub("fn.echo('$(path)\\\\file.txt')", '$(path)', 'C:\\temp');
    expect(evaluate(out)).toBe('C:\\temp\\file.txt');
  });

  it('escapes a real newline, keeping the expression on one line', () => {
    const out = sub("fn.echo('x $(text)')", '$(text)', 'a\nb');
    expect(out).not.toMatch(/\n/);
    expect(evaluate(out)).toBe('x a\nb');
  });
});

describe('a source value that is really a string', () => {
  // A DOTTED placeholder - $(ANSIBLE_FORMS.persistent_path), $(record.name) - is read out
  // of an object field, so AppForm takes the "full object reference" branch : it hands the
  // value over already JSON.stringify'd and flags it as source. For an array or object that
  // is right, the JSON text IS the value. For a string it is not : the quotes JSON wrapped
  // it in are not part of the path, and escaping them into the surrounding string rebuilt
  // the original bug in a new spelling -
  //   '\\"/home/mirko/server/persistent\\"/playbooks/vars/clusters.yml'
  // which still resolves to "/home/.../persistent"/playbooks/... and still ENOENTs.
  it('splices the string it denotes, not its JSON quotes, inside a longer string', () => {
    const out = sub("fn.fnReadYamlFile('$(ANSIBLE_FORMS.persistent_path)/playbooks/vars/clusters.yml')",
      '$(ANSIBLE_FORMS.persistent_path)', '"/home/mirko/server/persistent"', true);
    expect(out).toBe("fn.fnReadYamlFile('/home/mirko/server/persistent/playbooks/vars/clusters.yml')");
    expect(evaluate(out)).toBe('/home/mirko/server/persistent/playbooks/vars/clusters.yml');
  });

  it('still escapes the enclosing quote of a string source', () => {
    const out = sub("fn.echo('hello $(user.name)')", '$(user.name)', '"O\'Brien"', true);
    expect(evaluate(out)).toBe("hello O'Brien");
  });

  it('keeps splicing an array source as its JSON text inside a string', () => {
    const out = sub("fn.echo('rows=$(rows)')", '$(rows)', '[{"id":7}]', true);
    expect(evaluate(out)).toBe('rows=[{"id":7}]');
  });

  it('leaves a source that is not valid JSON untouched', () => {
    const out = sub("fn.echo('x $(v)')", '$(v)', 'notjson', true);
    expect(evaluate(out)).toBe('x notjson');
  });

  it('is unaffected when the placeholder is wrapped or bare', () => {
    expect(evaluate(sub("fn.echo('$(p)')", '$(p)', '"/a/b"', true))).toBe('/a/b');
    expect(evaluate(sub('$(n) + 1', '$(n)', '41', true))).toBe(42);
  });
});

describe('a placeholder wrapped in quotes', () => {
  it('replaces the quotes together with the placeholder', () => {
    const out = sub("fn.fnReadYamlFile('$(file)')", '$(file)', '/app/persistent/x.yml');
    expect(evaluate(out)).toBe('/app/persistent/x.yml');
  });

  it('cannot be broken out of by a value carrying the same quote', () => {
    const out = sub("fn.echo('$(name)')", '$(name)', "O'Brien");
    expect(evaluate(out)).toBe("O'Brien");
  });

  it('splices an array in as source, not as a quoted string', () => {
    const out = sub("fn.fnJq('$(rows)')", '$(rows)', '[{"id":7}]', true);
    expect(out).toBe('fn.fnJq([{"id":7}])');
    expect(evaluate(out)).toEqual([{ id: 7 }]);
  });

  it('leaves the other arguments alone', () => {
    const out = sub("fn.fnRestBasic('$(url)','get')", '$(url)', 'https://host/api');
    expect(out).toBe('fn.fnRestBasic("https://host/api",\'get\')');
    expect(evaluate(out)).toBe('get:https://host/api');
  });
});

describe('a placeholder outside any string', () => {
  it('keeps a number a number, so arithmetic still adds', () => {
    expect(evaluate(sub('$(count) + 1', '$(count)', 5))).toBe(6);
  });

  it('writes a string as a literal', () => {
    expect(evaluate(sub("$(name) + 'x'", '$(name)', 'srv1'))).toBe('srv1x');
  });

  it('keeps a boolean a boolean', () => {
    expect(evaluate(sub('$(flag) ? 1 : 2', '$(flag)', false))).toBe(2);
  });

  it('splices an array in as source', () => {
    expect(evaluate(sub('$(rows).length', '$(rows)', '[1,2,3]', true))).toBe(3);
  });
});

describe('the value is never read as a replacement pattern', () => {
  // String.replace with a STRING replacement re-interprets $& , $` , $' and $1 against the
  // match - a value containing any of them silently became the placeholder text, the
  // surrounding text, or a capture group.
  for (const evil of ['$&', "$'", '$`', '$1', '$$']) {
    it(`inserts ${evil} verbatim inside a string`, () => {
      expect(evaluate(sub("fn.echo('x $(v) y')", '$(v)', evil))).toBe(`x ${evil} y`);
    });
    it(`inserts ${evil} verbatim as a literal`, () => {
      expect(evaluate(sub("fn.echo('$(v)')", '$(v)', evil))).toBe(evil);
    });
  }
});

describe('several placeholders in one expression', () => {
  it('substitutes one occurrence at a time, left to right', () => {
    let out = sub("fn.echo('$(a)/$(b)')", '$(a)', 'first');
    out = sub(out, '$(b)', 'second');
    expect(evaluate(out)).toBe('first/second');
  });

  it('handles the same placeholder twice', () => {
    let out = sub("fn.echo('$(a)-$(a)')", '$(a)', 'x');
    out = sub(out, '$(a)', 'y');
    expect(evaluate(out)).toBe('x-y');
  });

  it('mixes a quoted and an embedded one', () => {
    let out = sub("fn.fnRestBasic('$(url)/items?q=$(q)','get')", '$(url)', 'https://host');
    out = sub(out, '$(q)', 'a b');
    expect(out).toBe("fn.fnRestBasic('https://host/items?q=a b','get')");
  });

  it('returns the expression unchanged when the placeholder is absent', () => {
    expect(sub("fn.echo('x')", '$(missing)', 'v')).toBe("fn.echo('x')");
  });
});

describe('the quote context scanner', () => {
  it('reports no quote outside a string', () => {
    expect(Helpers.quoteContextAt("fn.echo('a') + ", 13)).toBe(null);
  });

  it('reports the enclosing quote inside a string', () => {
    expect(Helpers.quoteContextAt("fn.echo('abc')", 9)).toBe("'");
  });

  it('ignores the other quote character inside a string', () => {
    // the apostrophe in "it's" does not open a string
    expect(Helpers.quoteContextAt('fn.echo("it\'s ok", 1)', 18)).toBe(null);
  });

  it('ignores an escaped quote', () => {
    expect(Helpers.quoteContextAt("fn.echo('it\\'s ok')", 15)).toBe("'");
  });
});
