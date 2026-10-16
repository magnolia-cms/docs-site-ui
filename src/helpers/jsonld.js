'use strict'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))?$/
const DOCS_SITE = 'https://docs.magnolia-cms.com'

function plainText (value) {
  if (value == null) return ''
  return String(value)
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function absoluteUrl (siteUrl, url) {
  if (!url) return undefined
  const value = String(url)
  if (/^https?:\/\//i.test(value)) return value
  if (!siteUrl || value.charAt(0) !== '/') return undefined
  return String(siteUrl).replace(/\/$/, '') + value
}

function crumbName (item) {
  return plainText(item && (item.content || item.title))
}

function buildBreadcrumbs (page, siteUrl) {
  const existing = Array.isArray(page.breadcrumbs) ? page.breadcrumbs : []
  const componentVersion = page.componentVersion
  const firstContent = existing.length ? existing[0].content : undefined
  const crumbs = []
  if (
    componentVersion &&
    componentVersion.title &&
    !componentVersion.root &&
    componentVersion.title !== firstContent
  ) {
    crumbs.push({
      content: componentVersion.title,
      url: componentVersion.url,
      urlType: 'internal',
    })
  }
  for (const item of existing) crumbs.push(item)

  const elements = []
  for (const item of crumbs) {
    const name = crumbName(item)
    if (!name) continue
    const entry = {
      '@type': 'ListItem',
      position: elements.length + 1,
      name,
    }
    const itemUrl = absoluteUrl(siteUrl, item.url)
    if (itemUrl) entry.item = itemUrl
    elements.push(entry)
  }
  return elements
}

function buildPageJsonLd (context) {
  const page = (context && context.page) || {}
  const site = (context && context.site) || {}
  const attrs = page.attributes || {}
  const siteUrl = site.url ? String(site.url).replace(/\/$/, '') : DOCS_SITE
  const authorName = plainText(attrs['meta-author']) || 'Magnolia Documentation Team'
  const orgName = plainText(attrs['meta-organization']) || 'Magnolia International Ltd'
  const orgUrl = plainText(attrs['meta-organization-url']) || 'https://www.magnolia-cms.com'
  const license = plainText(attrs['meta-content-usage-url']) || `${DOCS_SITE}/ai-governance/`
  const copyrightHolder = plainText(attrs['meta-copyright-holder']) || 'Magnolia International Ltd'
  const headline = plainText(page.title) || 'Documentation'
  const description = plainText(page.description)
  const canonical = page.canonicalUrl || absoluteUrl(siteUrl, page.url)
  const lastModified = plainText(attrs['last-modified'])

  const article = {
    '@type': 'TechArticle',
    headline,
    author: {
      '@type': 'Organization',
      name: authorName,
      url: orgUrl,
    },
    publisher: {
      '@type': 'Organization',
      name: orgName,
      url: orgUrl,
      logo: {
        '@type': 'ImageObject',
        url: `${DOCS_SITE}/welcome/_images/meta-og-2024.png`,
      },
    },
    inLanguage: 'en',
    license,
    usageInfo: license,
    copyrightHolder: {
      '@type': 'Organization',
      name: copyrightHolder,
    },
    copyrightYear: String(new Date().getFullYear()),
    isPartOf: {
      '@type': 'WebSite',
      name: plainText(site.title) || 'Magnolia CMS Documentation',
      url: siteUrl,
    },
  }
  if (description) article.description = description
  if (canonical) {
    article.url = canonical
    article.mainEntityOfPage = canonical
  }
  if (lastModified && ISO_DATE.test(lastModified)) article.dateModified = lastModified

  const graph = [article]
  const breadcrumbs = buildBreadcrumbs(page, siteUrl)
  if (breadcrumbs.length >= 2) {
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: breadcrumbs,
    })
  }

  return JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': graph,
  }, null, 2).replace(/</g, '\\u003c')
}

function jsonld () {
  return buildPageJsonLd(this)
}

jsonld.buildPageJsonLd = buildPageJsonLd
module.exports = jsonld
