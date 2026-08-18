const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const root = path.join(__dirname, '..');

async function source(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

test('active category and business-type code contains no removed sort_order field', async () => {
  const files = [
    'src/services/CategoryService.js',
    'src/services/BusinessTypeService.js',
    'src/components/CategoryForm.js',
    'src/components/BusinessTypeForm.js',
    'src/pages/CategoriesPage.js',
    'src/pages/BusinessTypesPage.js',
    'src/pages/RegisterPage.js',
    'src/pages/LegacyRegistrationPage.js',
    'src/pages/LookupPage.js',
  ];
  const contents = await Promise.all(files.map(source));
  for (const content of contents) assert.doesNotMatch(content, /sort_order/);
});

test('categories are ordered alphabetically by name', async () => {
  const service = await source('src/services/CategoryService.js');
  assert.match(service, /sort = \{ column: 'name', ascending: true \}/);
  assert.match(service, /\.order\('name', \{ ascending: true \}\)/);
});

test('business types are grouped by category and ordered by name within each group', async () => {
  const service = await source('src/services/BusinessTypeService.js');
  assert.match(service, /\.order\('category_id', \{ ascending: true \}\)\s*\.order\('name', \{ ascending: true \}\)/);
  assert.match(service, /\['category_id', 'category_name'\]\.includes\(column\)[\s\S]*sorted\.order\('name', \{ ascending: true \}\)/);
  const page = await source('src/pages/BusinessTypesPage.js');
  assert.match(page, /sort: \{ column: 'category_name', ascending: true \}/);
  assert.match(page, /BusinessTypeService\.listWithStats/);
});

test('category and business-type mutations never send removed sort_order', async () => {
  const [categoryService, businessTypeService] = await Promise.all([
    source('src/services/CategoryService.js'),
    source('src/services/BusinessTypeService.js'),
  ]);
  assert.doesNotMatch(categoryService, /sort_order/);
  assert.doesNotMatch(businessTypeService, /sort_order/);
});
