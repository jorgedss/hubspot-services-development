const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizePropertyOptions,
  createCategoryLabelMap,
  getCategoryLabel,
} = require("./categoryOptions");

test("uses property option labels while preserving values", () => {
  const options = [
    { value: "graduacao", label: "Graduação" },
    { value: "novo_valor", label: "Nova categoria" },
  ];
  const map = createCategoryLabelMap(options);

  assert.deepEqual(normalizePropertyOptions(options), options);
  assert.equal(getCategoryLabel("graduacao", map), "Graduação");
  assert.equal(getCategoryLabel("novo_valor", map), "Nova categoria");
});

test("falls back to the unknown value without throwing", () => {
  const map = createCategoryLabelMap([{ value: "graduacao", label: "Graduação" }]);

  assert.equal(getCategoryLabel("categoria_removida", map), "categoria_removida");
  assert.equal(getCategoryLabel(undefined, map), "");
  assert.deepEqual(normalizePropertyOptions(null), []);
  assert.deepEqual(normalizePropertyOptions([{ label: "Sem valor" }, null]), []);
});
