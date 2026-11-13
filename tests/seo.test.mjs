// Site wave 3: search engines and AI assistants. Every public page has its own title, description and
// canonical; the structured data (JSON-LD) parses and links up; private and test pages say noindex and are
// never in sitemap.xml; the committed sitemap.xml is exactly what a publish writes from content.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { loadGs } from '../tools/lib/gs.mjs';

const gs = loadGs(['Platforms.gs', 'Content.gs', 'Hub.gs', 'CompModel.gs', 'BookModel.gs', 'Pages.gs']);

const SITE = 'https://stathanasiosyouth.github.io/';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const content = JSON.parse(read('content.json'));

// the public pages: fixed ones + the published service pages / events / competitions in content.json
const FIXED = ['', 'about/', 'events/', 'services/', 'news/', 'about-site/', 'privacy/', 'terms/'];
const PUBLIC = [
  ...FIXED,
  ...(content.pages || []).map(p => p.slug + '/'),
  ...(content.events || []).map(e => 'events/' + e.slug + '/'),
  ...(content.competitions || []).map(c => 'competition/' + c.slug + '/')
];

// out of the index: accounts, points, the admin, the shells, the 404, and the test pages taken down
const TEST_STUBS = [...['events', 'competition'].flatMap(dir => readdirSync(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })
  .filter(d => d.isDirectory() && existsSync(new URL(`../${dir}/${d.name}/index.html`, import.meta.url)))
  .filter(d => {
    const json = JSON.parse(read(`${dir}/${d.name}/${dir === 'events' ? 'event' : 'comp'}.json`));
    return json.withdrawn === true;
  })
  .map(d => `${dir}/${d.name}/`))];
const PRIVATE = ['account/', 'points/', 'admin/', 'pages/', 'competition/', '404.html', ...TEST_STUBS];

const file = path => (path.endsWith('.html') ? path : path + 'index.html');
const head = html => html.slice(0, html.indexOf('</head>'));
const one = (html, re, what, path) => {
  const all = [...head(html).matchAll(new RegExp(re.source, 'g'))];
  assert.equal(all.length, 1, `${path || '/'}: one ${what}`);
  return all[0][1];
};
const ldBlocks = html => [...head(html).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
const graph = html => ldBlocks(html).flatMap(b => b['@graph'] || [b]);

test('every public page: one title, description and canonical, each its own; Open Graph and Twitter', () => {
  const seen = { title: new Map(), description: new Map() };
  for (const path of PUBLIC) {
    const html = read(file(path));
    const title = one(html, /<title>([^<]+)<\/title>/, 'title', path);
    const description = one(html, /<meta name="description" content="([^"]+)">/, 'description', path);
    const canonical = one(html, /<link rel="canonical" href="([^"]+)">/, 'canonical', path);
    assert.equal(canonical, SITE + path, `${path}: canonical is its own address`);
    assert.ok(description.length >= 40 && description.length <= 220, `${path}: a real description (${description.length})`);
    for (const [key, value] of Object.entries({ title, description })) {
      assert.ok(!seen[key].has(value), `${path}: ${key} also used by ${seen[key].get(value)}`);
      seen[key].set(value, path);
    }
    assert.doesNotMatch(head(html), /name="robots"/, `${path}: indexable`);
    if (!['privacy/', 'terms/'].includes(path)) {
      assert.match(html, new RegExp(`<meta property="og:url" content="${SITE.replace(/\./g, '\\.')}${path}">`), `${path}: og:url`);
      assert.match(html, /<meta property="og:image" content="https:\/\/[^"]+">/, `${path}: og:image`);
      assert.match(html, /<meta name="twitter:card" content="summary_large_image">/, `${path}: twitter card`);
    }
  }
});

test('the key words people search with are in the right places, without stuffing', () => {
  const home = read('index.html');
  assert.match(one(home, /<title>([^<]+)<\/title>/, 'title'), /أسرة البابا أثناسيوس الرسولي للشباب/);
  assert.match(one(home, /<title>([^<]+)<\/title>/, 'title'), /أبي سيفين بسفاجا/);
  const about = read('about/index.html');
  for (const words of ['اجتماع الشباب', 'كنيسة الشهيد العظيم أبي سيفين', 'سفاجا']) assert.ok(about.includes(words), words);
  const site = read('about-site/index.html');
  assert.match(one(site, /<meta name="description" content="([^"]+)">/, 'description'), /مينا زكريا/);
  // the developer's name never on the home page's head or in its title (quiet credit)
  assert.doesNotMatch(head(home), /مينا/);
  for (const path of PUBLIC) {
    const title = one(read(file(path)), /<title>([^<]+)<\/title>/, 'title', path);
    assert.ok(title.length <= 90, `${path}: title not stuffed (${title.length})`);
  }
});

test('structured data: parses, one family / church / site with shared @ids, the developer only on «عن الموقع»', () => {
  const byId = new Map();
  for (const path of PUBLIC) {
    const html = read(file(path));
    for (const block of ldBlocks(html)) assert.equal(block['@context'], 'https://schema.org', path);
    for (const node of graph(html)) {
      assert.ok(node['@type'], `${path}: typed`);
      if (node['@type'] === 'Person') assert.equal(path, 'about-site/', 'a Person only on /about-site/');
      if (node['@id']) {
        assert.ok(node['@id'].startsWith(SITE), node['@id']);
        const was = byId.get(node['@id']);
        if (was && was.name && node.name) assert.equal(node.name, was.name, `${node['@id']}: same name everywhere`);
        byId.set(node['@id'], { ...was, ...node });
      }
    }
  }
  const org = byId.get(SITE + '#org');
  assert.equal(org['@type'], 'Organization');
  assert.ok(org.sameAs.includes('https://www.facebook.com/Pope.Athanasius.The.Apostolic.Safaga'));
  for (const url of org.sameAs) assert.match(url, /^https:\/\//);
  assert.equal(org.location['@id'], SITE + '#church');
  const church = byId.get(SITE + '#church');
  assert.equal(church['@type'], 'Church');
  assert.equal(church.address.addressLocality, 'سفاجا');
  assert.equal(church.geo.latitude, content.location.lat);
  assert.equal(church.geo.longitude, content.location.lng);
  assert.equal(church.hasMap, content.location.mapsUrl);
  const site = byId.get(SITE + '#website');
  assert.equal(site['@type'], 'WebSite');
  assert.equal(site.publisher['@id'], SITE + '#org');
  const person = byId.get(SITE + 'about-site/#developer');
  assert.equal(person['@type'], 'Person');
  assert.equal(person.name, 'مينا زكريا');
  assert.equal(person.alternateName, 'مينا زكريا عطاالله متى');
  assert.equal(person.email, 'mailto:menazakmena@gmail.com');
  assert.deepEqual(person.sameAs, ['https://github.com/MenaZak']);
  assert.equal(site.creator['@id'], person['@id']);
  // the home's social links = content.json's (no invented profiles)
  const social = content.sections.flatMap(s => s.links || []).map(l => l.url);
  for (const url of org.sameAs) assert.ok(social.includes(url), `${url} is one of the family's own links`);
});

test('the developer page: the four project links exactly as given, WhatsApp support, no photo', () => {
  const html = read('about-site/index.html');
  for (const url of ['https://www.facebook.com/Pope.Athanasius.The.Apostolic.Safaga', 'https://stathanasiosyouth.github.io/',
    'https://www.facebook.com/BraveUnderGrace', 'https://www.facebook.com/MZCreativeMediaStudio', 'https://github.com/MenaZak']) {
    assert.ok(html.includes(`href="${url}"`), url);
  }
  assert.match(html, /href="https:\/\/wa\.me\/201276162016[?"]/);
  assert.match(html, /href="mailto:menazakmena@gmail\.com"/);
  // no fixed meeting time on «عن الأسرة» (it changes from the admin; the home has it live)
  assert.doesNotMatch(read('about/index.html'), /الساعة [٠-٩]|٨ لحد/);
  assert.doesNotMatch(html, /linkedin|portfolio/i);
  const body = html.slice(html.indexOf('<body>'));
  assert.deepEqual([...body.matchAll(/<img [^>]*src="([^"]+)"/g)].map(m => m[1]).filter(src => !/logo-128\.webp$/.test(src)), [], 'only the family logo');
  // the home links to it quietly, from the footer
  assert.match(read('assets/js/render.js'), /h\('a', \{ href: 'about-site\/' \}, 'تطوير الموقع والدعم الفني'\)/);
});

test('private and test pages: noindex, never in the sitemap', () => {
  assert.ok(TEST_STUBS.length >= 1, 'the withdrawn test pages were found');
  for (const path of PRIVATE) {
    assert.match(head(read(file(path))), /<meta name="robots" content="noindex(, nofollow)?">/, `${path}: noindex`);
  }
  const sitemap = read('sitemap.xml');
  for (const path of PRIVATE) assert.ok(!sitemap.includes(`<loc>${SITE}${path}</loc>`), `${path} not in the sitemap`);
  const robots = read('robots.txt');
  assert.match(robots, /^Sitemap: https:\/\/stathanasiosyouth\.github\.io\/sitemap\.xml$/m);
  // no public page is closed to crawlers
  const closed = [...robots.matchAll(/^Disallow: (\S+)$/gm)].map(m => m[1]);
  for (const path of PUBLIC) assert.ok(!closed.some(c => ('/' + path).startsWith(c)), `${path} crawlable`);
});

test('sitemap.xml = what a publish writes from content.json (every public page, nothing else)', () => {
  const xml = gs.siteSitemapXml_(content, SITE);
  assert.equal(read('sitemap.xml').replace(/\r\n/g, '\n'), xml);
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  assert.deepEqual([...locs].sort(), PUBLIC.map(p => SITE + p).sort());
  // a published event / competition joins; a bad slug never does
  const more = gs.siteSitemapXml_({ ...content, events: [{ slug: 'trip-1' }, { slug: '../x' }], competitions: [{ slug: 'quiz' }] }, SITE);
  assert.match(more, /<loc>https:\/\/stathanasiosyouth\.github\.io\/events\/trip-1\/<\/loc>/);
  assert.match(more, /<loc>https:\/\/stathanasiosyouth\.github\.io\/competition\/quiz\/<\/loc>/);
  assert.doesNotMatch(more, /\.\.\/x/);
});

test('a publish writes sitemap.xml with content.json; generated stubs drop the shells\' noindex', () => {
  assert.match(read('apps-script/Publish.gs'), /files\['sitemap\.xml'\] = siteSitemapXml_\(built\.content, config\.siteUrl\)/);
  const shell = read('competition/index.html');
  const stub = gs.compStubHtml_({ slug: 'quiz', title: 'مسابقة', description: 'وصف المسابقة' }, SITE, 'v1', shell);
  assert.doesNotMatch(stub, /name="robots"/);
  assert.match(stub, /<link rel="canonical" href="https:\/\/stathanasiosyouth\.github\.io\/competition\/quiz\/">/);
});

test('taken-down pages and competitions leave search results from the browser too', () => {
  assert.match(read('assets/js/page/main.js'), /if \(data && data\.withdrawn\) leaveSearch\(\);/);
  assert.match(read('assets/js/comp/main.js'), /if \(S\.def\.withdrawn\) \{\s+leaveSearch\(\);/);
});
