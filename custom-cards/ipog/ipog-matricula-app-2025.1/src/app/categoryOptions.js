const normalizePropertyOptions = (options) =>
  Array.isArray(options)
    ? options
        .filter((option) => option && option.value != null)
        .map(({ value, label }) => ({
          value: String(value),
          label: label == null || label === "" ? String(value) : String(label),
        }))
    : [];

const createCategoryLabelMap = (options) =>
  Object.fromEntries(
    normalizePropertyOptions(options).map(({ value, label }) => [value, label]),
  );

const getCategoryLabel = (value, labelMap) => {
  const normalizedValue = value == null ? "" : String(value);
  return labelMap?.[normalizedValue] || normalizedValue;
};

module.exports = {
  normalizePropertyOptions,
  createCategoryLabelMap,
  getCategoryLabel,
};
