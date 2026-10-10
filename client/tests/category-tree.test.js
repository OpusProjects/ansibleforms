// Moving a category around the tree (config/categories.js), shared by the settings
// Categories page and the designer's Edit categories modal.
//
// Nesting was always buildable and never editable: a category could be created under a
// parent and then only deleted, so restructuring meant retyping a whole subtree or
// hand-editing the yaml. These are the operations that make it editable.
//
// Two rules here are load-bearing and neither is obvious from the code:
//
//   - base_schema.json pins the Default category with `contains: {const: {name, icon}}`.
//     `const` is an EQUALITY match, so Default may not leave the top level and may not
//     gain an `items` key. Either one makes the array stop containing that exact object
//     and every save fails on a raw ajv error, far from the click that caused it.
//   - a form addresses a category by its PATH (`categories: [Infra/Databases]`), so a
//     move renames the category and all of its descendants. movedCategoryPaths is what
//     the editors show for that, because nothing else would tell you.
import { describe, it, expect } from 'vitest';
import {
  isDefaultCategory,
  flattenCategories,
  canMoveUp,
  canMoveDown,
  canIndent,
  canOutdent,
  moveCategoryUp,
  moveCategoryDown,
  indentCategory,
  outdentCategory,
  categoryPaths,
  movedCategoryPaths,
} from '@/config/categories';

const tree = () => [
  { name: 'Default', icon: 'bars' },
  {
    name: 'Infra',
    icon: 'server',
    items: [
      { name: 'Databases', icon: 'database' },
      { name: 'Network', icon: 'wifi' },
    ],
  },
  { name: 'Apps', icon: 'box' },
];

describe('reordering siblings', () => {
  it('moves a top level category up', () => {
    const cats = tree();
    expect(moveCategoryUp(cats, cats[2])).toBe(true);
    expect(cats.map((c) => c.name)).toEqual(['Default', 'Apps', 'Infra']);
  });

  it('moves a child within its own parent, not out of it', () => {
    const cats = tree();
    const network = cats[1].items[1];
    expect(moveCategoryUp(cats, network)).toBe(true);
    expect(cats[1].items.map((c) => c.name)).toEqual(['Network', 'Databases']);
    expect(cats.map((c) => c.name)).toEqual(['Default', 'Infra', 'Apps']);
  });

  it('moves down', () => {
    const cats = tree();
    expect(moveCategoryDown(cats, cats[1])).toBe(true);
    expect(cats.map((c) => c.name)).toEqual(['Default', 'Apps', 'Infra']);
  });

  it('refuses to move past either end', () => {
    const cats = tree();
    expect(canMoveUp(cats, cats[0])).toBe(false);
    expect(moveCategoryUp(cats, cats[0])).toBe(false);
    expect(canMoveDown(cats, cats[2])).toBe(false);
    expect(moveCategoryDown(cats, cats[2])).toBe(false);
    expect(cats.map((c) => c.name)).toEqual(['Default', 'Infra', 'Apps']);
  });
});

describe('changing the parent', () => {
  it('indents a category under the sibling above it', () => {
    const cats = tree();
    expect(indentCategory(cats, cats[2])).toBe(true); // Apps under Infra
    expect(cats.map((c) => c.name)).toEqual(['Default', 'Infra']);
    expect(cats[1].items.map((c) => c.name)).toEqual(['Databases', 'Network', 'Apps']);
  });

  it('takes the whole subtree with it', () => {
    const cats = tree();
    indentCategory(cats, cats[1]); // Infra under Default? no:
    // Default is the previous sibling and is protected, so nothing moved
    expect(cats[1].name).toBe('Infra');
    // with a movable sibling above, the children come along
    const other = [
      { name: 'A', icon: 'bars' },
      { name: 'B', icon: 'bars', items: [{ name: 'B1', icon: 'bars' }] },
    ];
    expect(indentCategory(other, other[1])).toBe(true);
    expect(categoryPaths(other)).toEqual(['A', 'A/B', 'A/B/B1']);
  });

  it('outdents a child to just after its old parent', () => {
    const cats = tree();
    const databases = cats[1].items[0];
    expect(outdentCategory(cats, databases)).toBe(true);
    expect(cats.map((c) => c.name)).toEqual(['Default', 'Infra', 'Databases', 'Apps']);
    expect(cats[1].items.map((c) => c.name)).toEqual(['Network']);
  });

  it('drops an emptied items list rather than leaving items: []', () => {
    const cats = [{ name: 'P', icon: 'bars', items: [{ name: 'C', icon: 'bars' }] }];
    outdentCategory(cats, cats[0].items[0]);
    expect(cats[0].items).toBeUndefined();
    expect(cats.map((c) => c.name)).toEqual(['P', 'C']);
  });

  it('refuses to indent the first row, which has no sibling above', () => {
    const cats = tree();
    expect(canIndent(cats, cats[0])).toBe(false);
    expect(canIndent(cats, cats[1].items[0])).toBe(false);
  });

  it('refuses to outdent something already at the top level', () => {
    const cats = tree();
    expect(canOutdent(cats, cats[1])).toBe(false);
    expect(outdentCategory(cats, cats[1])).toBe(false);
  });

  it('indent then outdent returns the tree to where it started', () => {
    const cats = tree();
    const apps = cats[2];
    indentCategory(cats, apps);
    outdentCategory(cats, apps);
    expect(categoryPaths(cats)).toEqual(categoryPaths(tree()));
  });
});

// Every one of these would save a config the server refuses with a raw schema error.
describe('the Default category the schema pins', () => {
  it('is recognised only at the top level, by name AND icon', () => {
    expect(isDefaultCategory({ name: 'Default', icon: 'bars' }, 0)).toBe(true);
    expect(isDefaultCategory({ name: 'Default', icon: 'bars' }, 1)).toBe(false);
    expect(isDefaultCategory({ name: 'Default', icon: 'server' }, 0)).toBe(false);
  });

  it('cannot be nested under another category', () => {
    const cats = [
      { name: 'Infra', icon: 'server' },
      { name: 'Default', icon: 'bars' },
    ];
    expect(canIndent(cats, cats[1])).toBe(false);
    expect(indentCategory(cats, cats[1])).toBe(false);
    expect(cats.map((c) => c.name)).toEqual(['Infra', 'Default']);
  });

  it('cannot be given children by indenting something into it', () => {
    const cats = tree(); // Default is above Infra
    expect(canIndent(cats, cats[1])).toBe(false);
    expect(indentCategory(cats, cats[1])).toBe(false);
    expect(cats[0].items).toBeUndefined();
  });

  it('does not block a category that has another sibling above it', () => {
    const cats = [
      { name: 'Default', icon: 'bars' },
      { name: 'Infra', icon: 'server' },
      { name: 'Apps', icon: 'box' },
    ];
    expect(canIndent(cats, cats[2])).toBe(true);
  });
});

describe('the paths a move leaves behind', () => {
  it('reports the paths that no longer exist', () => {
    const before = tree();
    const after = tree();
    indentCategory(after, after[2]); // Apps -> Infra/Apps
    expect(movedCategoryPaths(before, after)).toEqual(['Apps']);
    expect(categoryPaths(after)).toContain('Infra/Apps');
  });

  it('reports a whole subtree when a parent moves', () => {
    const before = tree();
    const after = tree();
    const infra = after[1];
    outdentCategory(after, infra.items[0]); // Databases leaves Infra
    expect(movedCategoryPaths(before, after)).toEqual(['Infra/Databases']);
  });

  it('says nothing when only the order changed', () => {
    const before = tree();
    const after = tree();
    moveCategoryDown(after, after[1]);
    expect(movedCategoryPaths(before, after)).toEqual([]);
  });

  it('reports a rename too, which orphans forms the same way', () => {
    const before = tree();
    const after = tree();
    after[2].name = 'Applications';
    expect(movedCategoryPaths(before, after)).toEqual(['Apps']);
  });

  it('ignores a half-typed row that has no name yet', () => {
    const before = tree();
    const after = tree();
    after.push({ name: '', icon: 'bars' });
    expect(movedCategoryPaths(before, after)).toEqual([]);
    expect(categoryPaths(after)).not.toContain('');
  });
});

describe('flattenCategories', () => {
  it('returns the original objects with their depth, in tree order', () => {
    const cats = tree();
    const flat = flattenCategories(cats);
    expect(flat.map((f) => [f.cat.name, f.depth])).toEqual([
      ['Default', 0],
      ['Infra', 0],
      ['Databases', 1],
      ['Network', 1],
      ['Apps', 0],
    ]);
    expect(flat[2].cat).toBe(cats[1].items[0]);
  });
});
