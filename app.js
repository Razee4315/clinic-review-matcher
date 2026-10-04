// Regulator notice check.
// Matches clinic names as a notice wrote them to clinic pages in a directory,
// then checks whether each page was last reviewed before the notice.

// Words that describe the kind of business, not which business it is.
const GENERIC = [
  /plastic\s*surgery/g, /\bclinic\b/g, /\bhospital\b/g, /\bps\b/g,
  /성형외과/g, /의원/g, /병원/g, /클리닉/g,
];

// "DA Plastic Surgery Clinic" and "DA Plastic Surgery" both become "da".
function nameKey(name) {
  let s = String(name || '').normalize('NFKC').toLowerCase();
  for (const g of GENERIC) s = s.replace(g, ' ');
  return s.replace(/[^\p{L}\p{N}]+/gu, '');
}

// The district (gu) is the second key. Short names like "AB" or "View" are too
// easy to confuse, so a name match alone is never treated as certain.
function district(text) {
  const m = /(gangnam|seocho|songpa|mapo|yongsan|jongno)(-gu|\s+district)?/i.exec(text || '');
  return m ? m[1].toLowerCase() : null;
}

// No fuzzy matching on purpose: showing a regulator notice on the wrong clinic
// is worse than missing one. A miss goes to a person; a wrong match is public.
function matchClinic(rawName, location, clinics) {
  const key = nameKey(rawName);
  if (!key) return { status: 'none' };
  const hits = clinics.filter(
    (c) => nameKey(c.name_en) === key || (c.name_ko && nameKey(c.name_ko) === key)
  );
  if (hits.length === 0) return { status: 'none' };
  if (hits.length > 1) return { status: 'ambiguous', hits };

  const clinic = hits[0];
  const pageDistrict = district(clinic.address);
  const noticeDistrict = district(location);
  if (pageDistrict && noticeDistrict && pageDistrict === noticeDistrict) {
    return { status: 'match', clinic, confidence: 'high', reason: 'Name and district both match.' };
  }
  if (!pageDistrict || !noticeDistrict) {
    return { status: 'match', clinic, confidence: 'medium', reason: 'Name matches. District could not be compared.' };
  }
  return {
    status: 'match', clinic, confidence: 'low',
    reason: `Name matches but district differs (notice: ${noticeDistrict}, page: ${pageDistrict}). Check the address first.`,
  };
}

function isStale(clinic, notice) {
  if (!clinic.last_reviewed) return null;
  return new Date(notice.date) > new Date(clinic.last_reviewed);
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

function fmtDate(iso) {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

function renderNotice(notice) {
  const box = document.getElementById('notice');
  box.replaceChildren(
    el('p', { class: 'eyebrow', text: `${notice.regulator} · ${fmtDate(notice.date)}` }),
    el('h3', { text: notice.action }),
    el('p', { text: notice.reason }),
    el('p', { class: 'muted', text: `Period covered: ${notice.period}. Law: ${notice.law}.` }),
    el('p', {}, [
      el('span', { class: 'muted', text: 'Source: ' }),
      el('a', { href: notice.source_url, target: '_blank', rel: 'noopener', text: notice.source_name }),
    ]),
    el('p', { class: 'muted', text: `Names as written in the source: ${notice.named.map((n) => `${n.raw} (${n.location})`).join('; ')}.` })
  );
}

function noticeBox(notice) {
  return el('div', { class: 'flag' }, [
    el('strong', { text: 'Regulator notice' }),
    el('p', { text: `${notice.regulator} issued a ${notice.action.toLowerCase()} on ${fmtDate(notice.date)}: ${notice.reason} Period covered: ${notice.period}.` }),
    el('p', { class: 'muted', text: 'Reviews posted in that period may include undisclosed sponsored posts. The star rating has not been recalculated.' }),
    el('a', { href: notice.source_url, target: '_blank', rel: 'noopener', text: `Source: ${notice.source_name}` }),
  ]);
}

function renderPreview(confirmed, notice) {
  const wrap = document.getElementById('preview');
  if (confirmed.length === 0) {
    wrap.replaceChildren(el('p', { class: 'empty', text: 'Nothing is shown yet. Press "Confirm match" in step 2 to see the notice a reader would get.' }));
    return;
  }
  wrap.replaceChildren(
    ...confirmed.map((c) =>
      el('article', { class: 'clinic' }, [
        el('h3', { text: c.name_en }),
        el('p', { class: 'muted', text: [c.name_ko, c.tier, c.rating ? `★ ${c.rating}` : null].filter(Boolean).join(' · ') }),
        noticeBox(notice),
        el('p', { class: 'muted', text: `Page last reviewed ${fmtDate(c.last_reviewed)}. Queued for a new review.` }),
      ])
    )
  );
}

function renderMatches(notice, clinics) {
  const tbody = document.querySelector('#matches tbody');
  const confirmed = new Map();
  const update = () => renderPreview([...confirmed.values()], notice);

  tbody.replaceChildren(
    ...notice.named.map((n) => {
      const r = matchClinic(n.raw, n.location, clinics);
      if (r.status !== 'match') {
        const why = r.status === 'ambiguous' ? 'More than one page has this name. Needs a person.' : 'No page with this name.';
        return el('tr', {}, [
          el('td', { text: n.raw }), el('td', { text: 'None' }), el('td', { text: why }),
          el('td', { text: '' }), el('td', { text: '' }), el('td', { text: '' }),
        ]);
      }
      const c = r.clinic;
      const stale = isStale(c, notice);
      const box = el('button', { type: 'button', class: 'btn', 'aria-pressed': 'false', text: 'Confirm match' });
      if (r.confidence === 'low') { box.disabled = true; box.textContent = 'Check address first'; }
      box.addEventListener('click', () => {
        const on = box.getAttribute('aria-pressed') !== 'true';
        box.setAttribute('aria-pressed', String(on));
        box.textContent = on ? 'Confirmed ✓' : 'Confirm match';
        if (on) confirmed.set(c.slug, c); else confirmed.delete(c.slug);
        update();
        if (on) document.getElementById('preview').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
      return el('tr', {}, [
        el('td', { text: `${n.raw} (${n.location})` }),
        el('td', {}, [
          el('a', { href: c.url, target: '_blank', rel: 'noopener', text: c.name_en }),
          el('div', { class: 'muted', text: c.address || 'Address not recorded' }),
        ]),
        el('td', {}, [el('span', { class: `pill ${r.confidence}`, text: r.confidence }), el('div', { class: 'muted', text: r.reason })]),
        el('td', { text: c.last_reviewed ? fmtDate(c.last_reviewed) : 'Unknown' }),
        el('td', {}, [
          el('span', { class: stale ? 'pill low' : 'pill high', text: stale === null ? 'Unknown' : stale ? 'Needs re-review' : 'Up to date' }),
          el('div', { class: 'muted', text: stale ? 'Reviewed before the notice.' : stale === false ? 'Reviewed after the notice.' : '' }),
        ]),
        el('td', {}, [box]),
      ]);
    })
  );
  update();
}

function renderUntouched(notice, clinics) {
  const matched = new Set(
    notice.named.map((n) => matchClinic(n.raw, n.location, clinics)).filter((r) => r.status === 'match').map((r) => r.clinic.slug)
  );
  const rest = clinics.filter((c) => !matched.has(c.slug));
  document.getElementById('untouched').textContent =
    `${rest.length} other pages checked and left alone: ${rest.map((c) => c.name_en).join(', ')}.`;
}

function wireTryIt(notice, clinics) {
  const input = document.getElementById('try-name');
  const out = document.getElementById('try-result');
  const run = () => {
    const value = input.value.trim();
    if (!value) { out.textContent = ''; return; }
    const r = matchClinic(value, '', clinics);
    if (r.status === 'none') out.textContent = `No page matches "${value}" (key: "${nameKey(value)}").`;
    else if (r.status === 'ambiguous') out.textContent = `More than one page matches. Needs a person.`;
    else out.textContent = `Matches ${r.clinic.name_en} (key: "${nameKey(value)}"). ${r.reason}`;
  };
  input.addEventListener('input', run);
}

async function main() {
  const [notices, clinics] = await Promise.all([
    fetch('data/notices.json').then((r) => r.json()),
    fetch('data/clinics.json').then((r) => r.json()),
  ]);
  const notice = notices[0];
  renderNotice(notice);
  renderMatches(notice, clinics);
  renderUntouched(notice, clinics);
  renderSummary(notice, clinics);
  wireTryIt(notice, clinics);
}

function renderSummary(notice, clinics) {
  const results = notice.named.map((n) => matchClinic(n.raw, n.location, clinics));
  const matched = results.filter((r) => r.status === 'match');
  const stale = matched.filter((r) => isStale(r.clinic, notice) === true);
  document.getElementById('summary').textContent =
    `${stale.length} of ${clinics.length} clinic pages need a new review.`;
}

main().catch((err) => {
  document.getElementById('notice').textContent = 'Could not load the data files: ' + err.message;
});
