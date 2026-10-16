'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const Handlebars = require('handlebars')
const jsonld = require('../src/helpers/jsonld')

Handlebars.registerHelper('jsonld', jsonld)
Handlebars.registerHelper('detag', require('../src/helpers/detag'))
Handlebars.registerHelper('or', require('../src/helpers/or'))
Handlebars.registerPartial(
  'head-meta',
  fs.readFileSync(path.join(__dirname, '../src/partials/head-meta.hbs'), 'utf8')
)

function articleFrom (context) {
  const parsed = JSON.parse(Handlebars.compile('{{{jsonld}}}')(context))
  assert.strictEqual(parsed['@context'], 'https://schema.org')
  return {
    parsed,
    article: parsed['@graph'][0],
    breadcrumbs: parsed['@graph'][1],
  }
}

const base = {
  site: { url: 'https://docs.magnolia-cms.com', title: 'Magnolia CMS Docs' },
  page: {
    title: 'What is <code>REST</code>?',
    canonicalUrl: 'https://docs.magnolia-cms.com/product-docs/6.4/rest.html',
    url: '/product-docs/6.4/rest.html',
    componentVersion: { title: 'Product documentation', url: '/product-docs/6.4/index.html' },
    breadcrumbs: [
      { content: 'Developing', url: '/product-docs/6.4/Developing.html', urlType: 'internal' },
      { content: 'What is <code>REST</code>?', url: '/product-docs/6.4/rest.html', urlType: 'internal' },
    ],
    attributes: {
      'last-modified': '2026-03-02T08:15:00+00:00',
    },
  },
}

const withDescription = articleFrom({
  ...base,
  page: { ...base.page, description: 'How Magnolia exposes content over HTTP.' },
})
assert.strictEqual(withDescription.article['@type'], 'TechArticle')
assert.strictEqual(withDescription.article.headline, 'What is REST?')
assert.strictEqual(withDescription.article.description, 'How Magnolia exposes content over HTTP.')
assert.strictEqual(withDescription.article.dateModified, '2026-03-02T08:15:00+00:00')
assert.strictEqual(withDescription.article.url, base.page.canonicalUrl)
assert.strictEqual(withDescription.breadcrumbs['@type'], 'BreadcrumbList')
assert.strictEqual(withDescription.breadcrumbs.itemListElement[0].name, 'Product documentation')
assert.strictEqual(
  withDescription.breadcrumbs.itemListElement[0].item,
  'https://docs.magnolia-cms.com/product-docs/6.4/index.html'
)
assert.strictEqual(withDescription.breadcrumbs.itemListElement[2].name, 'What is REST?')

const withoutDescription = articleFrom(base)
assert.ok(!('description' in withoutDescription.article))

const withoutDate = articleFrom({
  ...base,
  page: { ...base.page, attributes: { 'last-modified': 'yesterday' } },
})
assert.ok(!('dateModified' in withoutDate.article))
assert.ok(!('description' in withoutDate.article))

const quoted = articleFrom({
  site: base.site,
  page: {
    title: 'Say "hello" </script>',
    url: '/product-docs/6.4/hello.html',
  },
})
assert.strictEqual(quoted.article.headline, 'Say "hello"')
const quotedHtml = Handlebars.compile('{{{jsonld}}}')({
  site: base.site,
  page: { title: 'Say "hello" </script>', url: '/x.html' },
})
assert.ok(!quotedHtml.includes('</script>'))
assert.strictEqual(quoted.breadcrumbs, undefined)

const angleHtml = Handlebars.compile('{{{jsonld}}}')({
  site: base.site,
  page: { title: 'a < b', url: '/x.html' },
})
assert.strictEqual(JSON.parse(angleHtml)['@graph'][0].headline, 'a < b')
assert.ok(angleHtml.includes('\\u003c'))
assert.ok(!angleHtml.includes('< b'))

const bare = Handlebars.compile('{{> head-meta}}')({})
assert.ok(bare.includes('application/ld+json'))
assert.ok(!bare.includes('og:description'))
assert.ok(!bare.includes('Explore Magnolia CMS documentation for comprehensive guides'))

const described = Handlebars.compile('{{> head-meta}}')({
  page: {
    title: 'Cache',
    description: 'Flush and compression.',
    canonicalUrl: 'https://docs.magnolia-cms.com/cache.html',
  },
  site: base.site,
})
assert.ok(described.includes('content="Flush and compression."'))
assert.ok(described.includes('"description": "Flush and compression."'))
assert.ok(described.includes('content="Cache"'))
assert.ok(!described.includes('Explore Magnolia CMS documentation for comprehensive guides'))

console.log('jsonld tests passed')
