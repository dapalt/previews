const metricsDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', dateStyle: 'short' });
const featureLabels = {
  ack: 'Potwierdzenia informacji',
  reveal: 'Odkrycia wyniku losowania',
  add: 'Dodane pomysły',
  edit: 'Zmienione pomysły',
  delete: 'Usunięte pomysły',
  question: 'Anonimowe pytania',
  reply: 'Odpowiedzi na pytania',
  note: 'Komentarze do pomysłów',
  suggest: 'Wysłane propozycje',
  accepted: 'Przyjęte propozycje',
  rejected: 'Odrzucone propozycje',
  mode: 'Zmiany ustawień propozycji',
  choice: 'Oznaczenia wyboru prezentu',
  unlock: 'Cofnięcia wyboru prezentu',
  strike: 'Skreślone pomysły',
  'food-add': 'Jedzenie: dodane pozycje',
  'food-claim': 'Jedzenie: zajęte pozycje',
  'food-release': 'Jedzenie: zwolnione pozycje',
  'food-comment': 'Jedzenie: komentarze',
  'food-reply': 'Jedzenie: odpowiedzi',
};

export function recordMetric(event, person, action, body = {}, now = new Date()) {
  const feature = action === 'decide' ? body.decision : action;
  if (action !== 'visit' && !Object.hasOwn(featureLabels, feature)) return;
  const stats = event.metrics ??= { totals: {}, days: {} };
  const personStats = person.metrics ??= { visits: 0, used: [] };
  const day = stats.days[metricsDay.format(now)] ??= { visits: 0, actions: 0 };
  if (action === 'visit') {
    personStats.visits++;
    day.visits++;
  } else {
    stats.totals[feature] = (stats.totals[feature] ?? 0) + 1;
    if (!personStats.used.includes(feature)) personStats.used.push(feature);
    day.actions++;
  }
}

function progressTotals(people) {
  return {
    entered: people.filter(p => p.metrics?.visits > 0).length,
    pins: people.filter(p => p.pin || p.practicePinSet).length,
    revealed: people.filter(p => p.revealed).length,
    lists: people.filter(p => p.items?.length > 0).length,
    chosen: people.filter(p => p.state === 'selected' || p.state === 'bought').length,
  };
}

const visitBuckets = ['0', '1', '2–5', '6+'];
const dayMillis = 86_400_000;
const dateFromDay = day => new Date(day * dayMillis).toISOString().slice(0, 10);
export const warsawMetricsDay = now => metricsDay.format(now);

function aggregateMetrics(event) {
  const { people } = event;
  const visitCounts = people.map(p => p.metrics?.visits ?? 0);
  const features = Object.fromEntries(Object.keys(featureLabels)
    .filter(key => !key.startsWith('food-') || event.food?.enabled || event.metrics?.totals[key])
    .map(key => [key, [event.metrics?.totals[key] ?? 0, people.filter(p => p.metrics?.used.includes(key)).length]]));
  return {
    participants: people.length,
    ...progressTotals(people),
    features,
    distribution: people.length < 5 ? null : [
      visitCounts.filter(n => n === 0).length,
      visitCounts.filter(n => n === 1).length,
      visitCounts.filter(n => n >= 2 && n <= 5).length,
      visitCounts.filter(n => n >= 6).length,
    ],
  };
}

export const metricsSnapshot = (event, now = new Date()) => ({ date: warsawMetricsDay(now), ...aggregateMetrics(event) });
export const metricsChanged = (previous, next) =>
  JSON.stringify(previous.metrics?.days) !== JSON.stringify(next.metrics?.days) ||
  JSON.stringify(aggregateMetrics(previous)) !== JSON.stringify(aggregateMetrics(next));

function activityDays(event) {
  return Object.entries(event.metrics?.days ?? {}).sort(([a], [b]) => b.localeCompare(a))
    .map(([date, { visits, actions }]) => ({ date, visits, actions }));
}

function displayAggregates({ features, distribution, purchased, ...counts }) {
  return {
    ...counts,
    features: Object.entries(featureLabels).filter(([key]) => Object.hasOwn(features, key))
      .map(([key, label]) => ({ label, total: features[key][0], people: features[key][1] })),
    distribution: counts.participants >= 5 && distribution ? distribution.map((n, i) => [visitBuckets[i], n]) : null,
  };
}

export function summarizeMetrics(event) {
  return { ...displayAggregates(aggregateMetrics(event)), days: activityDays(event) };
}

export function metricsReport(event, history, now = new Date()) {
  const today = warsawMetricsDay(now);
  const through = dateFromDay(calendarDay(today) - 1);
  const progress = history.filter(({ date }) => validMetricDate(date) && date < today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const latest = progress.at(-1);
  if (!latest) return { through };
  const { date, ...counts } = latest;
  if (date < through) progress.push({ ...latest, date: through });
  return { ...displayAggregates(counts), through, progress, days: activityDays(event).filter(row => row.date < today) };
}

const metricNumber = n => Number.isSafeInteger(n) && n >= 0 ? n : 0;
const progressSeries = [
  ['entered', 'Weszli na swoje konto', 'Weszli na konto'],
  ['pins', 'Mają ustawiony PIN', 'Ustawiony PIN'],
  ['revealed', 'Odkryli wynik losowania', 'Odkryty wynik losowania'],
  ['lists', 'Mają co najmniej jeden pomysł', 'Co najmniej jeden pomysł'],
  ['chosen', 'Wiedzą, co dadzą', 'Wybrany prezent'],
];
const activitySeries = [['visits', 'Wejścia'], ['actions', 'Akcje']];
const metricMeasure = (n, max) => {
  const value = metricNumber(n);
  if (max === undefined) return value;
  return `<span class="metric-measure"><meter aria-hidden="true" value="${value}" max="${Math.max(1, metricNumber(max))}"></meter><strong>${value}</strong></span>`;
};
const metricsFacts = rows => '<dl class="metrics-facts">' + rows.map(([label, n, max]) =>
  `<div><dt>${label}</dt><dd>${metricMeasure(n, max)}</dd></div>`).join('') + '</dl>';
const metricsTable = (head, rows, max) => `<table class="metrics-table"><thead><tr>
${head.map(label => `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${rows.map(([label, ...counts]) =>
  `<tr><th scope="row">${label}</th>${counts.map((n, i) => `<td>${metricMeasure(n, i === 0 ? max : undefined)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

const validMetricDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date));
const calendarDay = date => Date.parse(date) / dayMillis;
const oneDay = '<p class="mt-sm">Na razie są dane tylko z jednego dnia. Linie pojawią się po zakończeniu kolejnego dnia objętego statystykami.</p>';

function metricChart(rows, key, label, max, heading, zeroGaps) {
  const first = calendarDay(rows[0].date);
  const span = calendarDay(rows.at(-1).date) - first;
  const x = day => span ? 48 + (day - first) / span * 268 : 182;
  const y = n => 92 - n / max * 70;
  const ticks = max > 1 ? [0, Math.floor(max / 2), max] : [0, max];
  const dateLabels = span
    ? [[first, 'start'], ...(span >= 2 ? [[first + Math.round(span / 2), 'middle']] : []), [first + span, 'end']]
    : [[first, 'middle']];
  const raw = rows.map(row => [calendarDay(row.date), metricNumber(row[key])]);
  const points = raw.flatMap(([day, value], index) => {
    const previous = raw[index - 1]?.[0];
    if (previous === undefined || day - previous <= 1) return [[day, value]];
    if (!zeroGaps) return [[day - 1, raw[index - 1][1]], [day, value]];
    return day - previous === 2 ? [[day - 1, 0], [day, value]] : [[previous + 1, 0], [day - 1, 0], [day, value]];
  });
  return `<div class="metric-chart metric-trend-${key}">
<${heading}>${label}: ${raw.at(-1)[1]}</${heading}>
<svg aria-hidden="true" focusable="false" viewBox="0 0 332 125">
${ticks.map(n => `<path class="metric-gridline" d="M48 ${y(n)}H316"/><text x="42" y="${y(n) + 5}" text-anchor="end">${n}</text>`).join('')}
${dateLabels.map(([day, anchor]) => {
    const [, month, date] = new Date(day * 86_400_000).toISOString().slice(0, 10).split('-');
    return `<text x="${x(day)}" y="118" text-anchor="${anchor}">${date}.${month}</text>`;
  }).join('')}
${points.length > 1 ? `<polyline points="${points.map(([day, value]) => `${x(day).toFixed(2)},${y(value).toFixed(2)}`).join(' ')}"/>` : ''}
${(raw.length <= 24 ? raw : []).map(([day, value]) => `<circle cx="${x(day).toFixed(2)}" cy="${y(value).toFixed(2)}" r="3"/>`).join('')}
</svg>
</div>`;
}

function progressTimeline(rows) {
  if (!rows.length) return '';
  const series = progressSeries.map(([key, , label]) => [key, label]);
  const max = rows.reduce((highest, { participants }) => Math.max(highest, metricNumber(participants)), 1);
  return `<section class="section-gap" aria-labelledby="metrics-progress-history"><h2 id="metrics-progress-history">Postępy w czasie</h2>
<p class="mt-sm">Wykresy pokazują liczbę osób na koniec dnia, a liczba przy tytule dotyczy ostatniego dnia. Wcześniejszych wyników nie odtwarzamy. W dniach bez zmian obowiązuje ostatni zapis.</p>
${rows.length === 1 ? oneDay : ''}
<div class="metric-charts metric-progress-trend">${series.map(([key, label]) => metricChart(rows, key, label, max, 'h3')).join('')}</div>
<details class="mt-sm"><summary>Dokładne liczby według dni</summary>
${rows.slice().reverse().map(row => `<h3 class="mt-sm"><time datetime="${row.date}">${row.date}</time></h3>
${metricsFacts(series.map(([key, label]) => [label, row[key]]))}`).join('')}</details></section>`;
}

export function metricsContent(summary) {
  const { participants, features, days, distribution, progress = [], through } = summary;
  const note = through ? `<p class="notice mt-sm">Stan na koniec wczorajszego dnia (<time datetime="${through}">${through.slice(8)}.${through.slice(5, 7)}</time>). Dzisiejsze dane pojawią się po północy czasu polskiego.</p>` : '';
  if (!days) return '<p class="notice mt-sm">Statystyki pojawią się po zakończeniu pierwszego dnia zbierania danych, o północy czasu polskiego.</p>';
  const validDays = days.filter(({ date }) => validMetricDate(date));
  const activity = validDays.slice().reverse();
  if (activity.length && through > activity.at(-1).date) activity.push({ date: through, visits: 0, actions: 0 });
  const dailyRows = validDays.map(({ date, visits, actions }) => [date, visits, actions]);
  const mostVisits = dailyRows.reduce((max, [, visits]) => Math.max(max, metricNumber(visits)), 0);
  const activityMax = validDays.reduce((max, { visits, actions }) => Math.max(max, metricNumber(visits), metricNumber(actions)), 1);
  return `${note}<section class="section-gap" aria-labelledby="metrics-progress"><h2 id="metrics-progress">Postępy</h2>
<p class="mt-sm">Pełny pasek oznacza wszystkich uczestników.</p>
${metricsFacts([['Uczestnicy', participants], ...progressSeries.map(([key, label]) => [label, summary[key], participants])])}</section>
${progressTimeline(progress)}
<section class="section-gap" aria-labelledby="metrics-visits"><h2 id="metrics-visits">Wejścia na konto</h2>
<p class="mt-sm">Wejście liczy się po poprawnym PIN-ie lub po otwarciu wspólnego linku na zapamiętanym urządzeniu.</p>
${distribution ? metricsTable(['Liczba wejść', 'Osoby'], distribution, participants) :
    '<p class="notice mt-sm">Podział wejść jest widoczny od 5 uczestników.</p>'}</section>
<section class="section-gap" aria-labelledby="metrics-daily"><h2 id="metrics-daily">Aktywność według dni</h2>
${dailyRows.length ? '<p class="mt-sm">Pełny pasek oznacza dzień z największą liczbą wejść.</p>' +
    metricsTable(['Dzień', 'Wejścia', 'Akcje'], dailyRows, mostVisits) +
    '<h3 class="mt">Aktywność w czasie</h3><p class="mt-sm">Liczba przy tytule dotyczy ostatniego dnia.</p>' + (activity.length === 1 ? oneDay :
      '<p class="mt-sm">Brak dnia w tabeli oznacza 0 wejść i 0 akcji.</p>') +
    `<div class="metric-charts metric-activity-trend">${activitySeries.map(([key, label]) => metricChart(activity, key, label, activityMax, 'h4', true)).join('')}</div>` :
    '<p class="mt-sm">Nie odnotowano jeszcze aktywności.</p>'}</section>
<section class="section-gap" aria-labelledby="metrics-features"><h2 id="metrics-features">Użycie funkcji</h2>
<p class="mt-sm">„Osoby” to liczba obecnych uczestników, którzy użyli danej funkcji.</p>
${metricsTable(['Funkcja', 'Użycia', 'Osoby'], features.map(({ label, total, people }) => [label, total, people]))}</section>`;
}

export const editableFieldSelector = ':is(textarea, input:is([type=text], [type=password], [type=search], [type=email], [type=url], [type=tel], [type=number], :not([type]))):not(:disabled, [readonly])';
const isKeyboardGap = (gap, restingHeight) => gap > Math.max(100, restingHeight * 0.2);
const viewportSettleDelay = 120;
const minRevealResize = 24;

function revealCaret(field) {
  if (field.scrollHeight <= field.clientHeight) return;
  const caret = field.selectionDirection === 'backward' ? field.selectionStart : field.selectionEnd;
  if (caret === field.value.length) {
    field.scrollTop = field.scrollHeight;
    return;
  }

  const style = getComputedStyle(field);
  const mirror = document.createElement('div');
  Object.assign(mirror.style, { position: 'fixed', visibility: 'hidden', left: '-10000px', top: '0',
    width: field.clientWidth + 'px', boxSizing: 'border-box' });
  for (const property of ['font', 'lineHeight', 'letterSpacing', 'padding', 'whiteSpace', 'overflowWrap',
    'wordBreak', 'textIndent', 'tabSize', 'direction']) mirror.style[property] = style[property];
  const text = document.createTextNode(field.value[caret] === '\n'
    ? field.value.slice(0, caret) + '\u200b' + field.value.slice(caret) : field.value);
  mirror.append(text);
  document.body.append(mirror);
  const range = document.createRange();
  range.setStart(text, caret);
  range.setEnd(text, caret + 1);
  const next = range.getBoundingClientRect();
  let { top, bottom } = next;
  const lineHeight = parseFloat(style.lineHeight);
  const leading = Number.isFinite(lineHeight) ? Math.max(0, lineHeight - (bottom - top)) / 2 : 0;
  if (caret > 0 && field.value[caret - 1] !== '\n') {
    range.setStart(text, caret - 1);
    range.setEnd(text, caret);
    const previous = range.getBoundingClientRect();
    if (previous.top < top) {
      top = previous.top;
      if (bottom - top + 2 * leading > field.clientHeight) bottom = previous.bottom;
    }
  }
  const origin = mirror.getBoundingClientRect().top;
  mirror.remove();
  const visibleTop = field.scrollTop;
  const visibleBottom = visibleTop + field.clientHeight;
  if (top - origin - leading < visibleTop) field.scrollTop = top - origin - leading;
  else if (bottom - origin + leading > visibleBottom) field.scrollTop = bottom - origin + leading - field.clientHeight;
}

export function keepEditingFieldVisible() {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  const header = document.querySelector('.topbar');
  const footer = document.querySelector('.nav, .ack-bar');
  let frame;
  let reveal = false;
  let keyboardWasOpen = false;
  let lastRevealWidth;
  let lastRevealHeight;
  let manualScroll = false;
  let touching = false;
  let settleTimer;
  let viewportSettled = false;
  const touchDevice = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
  let layoutWidth = window.innerWidth;
  let layoutHeight = window.innerHeight;
  let restingHeight = layoutHeight;
  let layoutKeyboardOpen = false;
  let editingScrollY;

  const visualTop = () => Math.max(0, viewport?.offsetTop ?? 0);
  const syncEditingHeader = () => {
    if (root.hasAttribute('data-keyboard-open')) root.style.setProperty('--visual-viewport-top', visualTop() + 'px');
    else root.style.removeProperty('--visual-viewport-top');
  };
  const update = () => {
    frame = undefined;
    const requestedReveal = reveal;
    const settled = viewportSettled;
    reveal = false;
    viewportSettled = false;
    const field = document.activeElement;
    const editing = Boolean(field?.matches(editableFieldSelector));
    const width = window.innerWidth;
    const innerHeight = window.innerHeight;
    const sameWidth = width === layoutWidth;
    const wasLayoutKeyboardOpen = layoutKeyboardOpen;
    if (!sameWidth) {
      restingHeight = editing && wasLayoutKeyboardOpen ? layoutWidth : innerHeight;
    }
    layoutKeyboardOpen = touchDevice && editing && isKeyboardGap(restingHeight - innerHeight, restingHeight);
    if (!editing || innerHeight > restingHeight || (wasLayoutKeyboardOpen && !layoutKeyboardOpen)) {
      restingHeight = innerHeight;
    }

    const clientHeight = root.clientHeight;
    const height = viewport?.height ?? clientHeight;
    const scale = viewport?.scale ?? 1;
    const scaledGap = clientHeight - height * scale;
    const zoomedWithoutKeyboard = scale !== 1 && scaledGap <= 1;
    const visibleBottom = visualTop() + height;
    const keyboardInset = Math.max(0, clientHeight - visibleBottom);
    const keyboardOpen = editing && (layoutKeyboardOpen || isKeyboardGap(scaledGap, clientHeight));
    const openingKeyboard = keyboardOpen && !keyboardWasOpen;
    keyboardWasOpen = keyboardOpen;
    const restoreScroll = wasLayoutKeyboardOpen && !keyboardOpen && sameWidth &&
      innerHeight > layoutHeight && footer?.matches('.nav');
    if (layoutKeyboardOpen && (!wasLayoutKeyboardOpen || !sameWidth)) editingScrollY = window.scrollY;
    layoutWidth = width;
    layoutHeight = innerHeight;
    root.toggleAttribute('data-keyboard-open', keyboardOpen);
    syncEditingHeader();
    if (!keyboardOpen) {
      root.style.removeProperty('--keyboard-inset');
      manualScroll = false;
    } else if (openingKeyboard || settled) {
      if (keyboardInset > 1) root.style.setProperty('--keyboard-inset', keyboardInset + 'px');
      else root.style.removeProperty('--keyboard-inset');
    }
    if (restoreScroll) window.scrollTo({ top: editingScrollY, behavior: 'instant' });
    if (!editing || (!keyboardOpen && zoomedWithoutKeyboard)) {
      root.style.removeProperty('--editing-height');
      return;
    }
    const resizedWhileEditing = settled && !manualScroll &&
      (width !== lastRevealWidth || Math.abs(height - lastRevealHeight) >= minRevealResize);
    if (keyboardOpen && !openingKeyboard && !requestedReveal && !resizedWhileEditing) return;
    lastRevealWidth = width;
    lastRevealHeight = height;
    const top = Math.max(visualTop(), header?.getBoundingClientRect().bottom ?? 0) + 8;
    let bottom = visibleBottom;
    const footerRect = footer?.getBoundingClientRect();
    if (footerRect && footerRect.bottom > top) bottom = Math.min(bottom, footerRect.top);
    bottom -= 8;
    if (bottom <= top) return;

    const previousHeight = field.clientHeight;
    root.style.setProperty('--editing-height', Math.floor(bottom - top) + 'px');
    if (field.tagName === 'TEXTAREA' && field.clientHeight < previousHeight) revealCaret(field);
    if (!keyboardOpen && !requestedReveal) return;
    const rect = field.getBoundingClientRect();
    const delta = rect.top < top ? rect.top - top : Math.max(0, rect.bottom - bottom);
    if (delta) {
      window.scrollBy({ top: delta, behavior: 'instant' });
      if (layoutKeyboardOpen) editingScrollY = window.scrollY;
    }
  };

  const schedule = () => {
    if (frame === undefined) frame = requestAnimationFrame(update);
  };
  const scheduleReveal = () => {
    manualScroll = false;
    reveal = true;
    schedule();
  };
  const settleViewport = () => {
    clearTimeout(settleTimer);
    settleTimer = undefined;
    viewportSettled = false;
    if (!keyboardWasOpen || touching) return;
    settleTimer = setTimeout(() => {
      settleTimer = undefined;
      viewportSettled = true;
      schedule();
    }, viewportSettleDelay);
  };
  const resize = () => {
    settleViewport();
    schedule();
  };
  document.addEventListener('focusin', scheduleReveal);
  document.addEventListener('focusout', schedule);
  document.addEventListener('input', scheduleReveal);
  const passive = { passive: true };
  window.addEventListener('touchstart', () => {
    touching = true;
    settleViewport();
  }, passive);
  window.addEventListener('touchmove', event => {
    if (keyboardWasOpen && event.touches.length === 1) manualScroll = true;
  }, passive);
  const finishTouch = event => {
    touching = event.touches.length > 0;
    settleViewport();
  };
  window.addEventListener('touchend', finishTouch, passive);
  window.addEventListener('touchcancel', finishTouch, passive);
  window.addEventListener('wheel', event => {
    if (keyboardWasOpen && event.deltaY && !event.ctrlKey) manualScroll = true;
  }, passive);
  window.addEventListener('scroll', () => {
    if (layoutKeyboardOpen && window.innerWidth === layoutWidth && window.innerHeight === layoutHeight) {
      editingScrollY = window.scrollY;
    }
    if (settleTimer !== undefined) settleViewport();
  }, passive);
  window.addEventListener('resize', resize);
  viewport?.addEventListener('resize', resize);
  viewport?.addEventListener('scroll', () => {
    syncEditingHeader();
    settleViewport();
  });
  scheduleReveal();
}

const ideaEditMinutes = 5;
const ideaEditWindow = ideaEditMinutes * 60_000;
const ideaDayFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
});

export const ideaEditHint = `Możesz zmienić lub usunąć pomysł przez ${ideaEditMinutes} minut od dodania.`;
export const ideaEditExpired = `Minęło ${ideaEditMinutes} minut od dodania, więc tego pomysłu nie możesz już zmienić ani usunąć.`;

const preciseIdeaTime = createdAt => createdAt?.[10] === 'T' ? Date.parse(createdAt) : NaN;
export const ideaEditDeadline = createdAt => preciseIdeaTime(createdAt) + ideaEditWindow;
export function ideaCreationDay(createdAt) {
  const instant = preciseIdeaTime(createdAt);
  return Number.isFinite(instant) ? ideaDayFormatter.format(instant) : createdAt?.slice(0, 10);
}

export function watchIdeaEditWindows(root) {
  const timers = Array.from(root.querySelectorAll('[data-idea-edit-remaining]'), card => {
    const expire = () => {
      for (const el of card.querySelectorAll('[data-idea-edit-open]')) el.hidden = true;
      for (const el of card.querySelectorAll('[data-idea-edit-locked]')) el.hidden = false;
    };
    return setTimeout(expire, Number(card.dataset.ideaEditRemaining));
  });
  return () => timers.forEach(clearTimeout);
}

export function trackFocusModality() {
  const root = document.documentElement;
  const storageKey = 'upominki:pointer-focus';
  const setPointer = pointer => root.toggleAttribute('data-pointer-focus', pointer);
  try {
    setPointer(sessionStorage.getItem(storageKey) === '1');
    sessionStorage.removeItem(storageKey);
  } catch {
    // The browser may block storage.
  }
  document.addEventListener('pointerdown', () => setPointer(true), true);
  document.addEventListener('keydown', () => setPointer(false), true);
  window.addEventListener('pagehide', () => {
    try {
      if (root.hasAttribute('data-pointer-focus')) sessionStorage.setItem(storageKey, '1');
      else sessionStorage.removeItem(storageKey);
    } catch {
      // The browser may block storage.
    }
  });
}

export function measureBars() {
  const nav = document.querySelector('.nav');
  nav?.classList.add('measured');
  const bars = [['--topbar-height', document.querySelector('.topbar')],
    ['--bottom-bar-height', nav || document.querySelector('.ack-bar')]].filter(([, bar]) => bar);
  const update = () => {
    for (const [property, bar] of bars) document.documentElement.style.setProperty(property, bar.offsetHeight + 'px');
  };
  update();
  window.addEventListener('load', update, { once: true });
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(update);
    for (const [, bar] of bars) observer.observe(bar, { box: 'border-box' });
  } else {
    window.addEventListener('resize', update);
  }
}

export function showResult(result, snackbar, announcement) {
  snackbar.setAttribute('aria-hidden', 'true');
  const { top, height } = snackbar.getBoundingClientRect();
  const headerBottom = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
  const gap = parseFloat(getComputedStyle(document.documentElement).fontSize) * 0.75;
  document.documentElement.style.setProperty('--snackbar-height', height + 'px');
  result.tabIndex = -1;
  result.setAttribute('data-action-focus', '');
  result.focus({ preventScroll: true });
  const bounds = result.getBoundingClientRect();
  const start = headerBottom + gap;
  const end = top - gap;
  if (bounds.height > end - start || bounds.top < start) {
    window.scrollBy(0, bounds.top - start);
  } else if (bounds.bottom > end) {
    window.scrollBy(0, bounds.bottom - end);
  }
  announcement.textContent = '';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (snackbar.isConnected) announcement.textContent = snackbar.textContent;
  }));
}

export const recommendedHomeNameLength = 12;
const homeNameSegmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('pl', { granularity: 'grapheme' }) : null;

export function homeNamePreview(value, eventName) {
  const custom = typeof value === 'string' ? value.trim() : '';
  const name = custom || eventName;
  const length = Array.from(homeNameSegmenter ? homeNameSegmenter.segment(name) : name).length;
  return { name, count: `${length}/${recommendedHomeNameLength}`, usingFallback: !custom, warn: length > recommendedHomeNameLength };
}

export function previewHomeScreen() {
  const picker = document.querySelector('[data-home-screen-picker]');
  if (!picker) return;
  const image = picker.querySelector('[data-home-screen-icon]');
  const name = picker.querySelector('#homeName');
  const count = picker.querySelector('[data-home-name-count]');
  const fallback = picker.querySelector('[data-home-name-fallback]');
  const warning = picker.querySelector('[data-home-name-warning]');
  const label = picker.querySelector('[data-home-name-preview]');
  name.addEventListener('input', () => {
    const preview = homeNamePreview(name.value, name.placeholder);
    count.textContent = preview.count;
    fallback.hidden = !preview.usingFallback;
    warning.hidden = !preview.warn;
    label.textContent = preview.name;
  });
  picker.addEventListener('change', () => {
    const symbol = picker.querySelector('[name="homeSymbol"]:checked')?.value;
    const color = picker.querySelector('[name="homeColor"]').value;
    if (symbol) image.src = `${picker.dataset.homeScreenPicker}${symbol}-${color}-192.png`;
  });
}

export function textareaLimitText(length, max) {
  if (length > max) return `${length} / ${max} znaków — przekroczono limit.`;
  if (length === max) return `${length} / ${max} znaków — osiągnięto limit.`;
  if (length >= max * 0.9) return `${length} / ${max} znaków`;
  return `Limit: ${max} znaków`;
}

export function watchTextareaLimits(root) {
  const update = field => {
    const helpId = field.dataset?.textareaLimit;
    if (!helpId) return;
    const help = root.getElementById(helpId);
    const message = textareaLimitText(field.value.length, field.maxLength);
    if (help.textContent !== message) help.textContent = message;
  };
  for (const field of root.querySelectorAll('[data-textarea-limit]')) update(field);
  root.addEventListener('input', event => update(event.target));
  root.addEventListener('focusin', event => update(event.target));
}


const storagePrefix = 'upominki-preview:';
const warsawDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', dateStyle: 'short' });
const warsawDateTime = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', dateStyle: 'short', timeStyle: 'short' });

export function previewStore(storage, scope, initial) {
  const key = storagePrefix + scope;
  return {
    key,
    read: () => JSON.parse(storage.getItem(key) ?? 'null') ?? structuredClone(initial),
    write: state => storage.setItem(key, JSON.stringify(state)),
    reset: () => storage.removeItem(key),
  };
}

const check = (condition, message = 'Ta czynność nie jest teraz dostępna.', field) => {
  if (!condition) throw Object.assign(new Error(message), { field });
};
const value = (field, limit) => String(field ?? '').trim().slice(0, limit);
const text = (field, limit) => {
  const result = value(field, limit);
  check(result, 'Uzupełnij wymagane pole.');
  return result;
};
const link = field => {
  const url = value(field, 2048);
  if (!url) return '';
  const parsed = URL.parse(url);
  check(parsed && ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password, 'Podaj pełny link HTTP lub HTTPS.');
  return parsed.href;
};
const idea = fields => ({
  title: text(fields.title, 140), description: value(fields.description, 1500),
  price: value(fields.price, 100), link: link(fields.link),
});
const unreadList = person => [
  ...person.items.flatMap(item => item.threads),
  ...(person.state === 'open' ? person.suggestions.filter(s => s.status === 'pending') : []),
].filter(entry => entry.unreadByOwner);
const unreadGiver = person => person ? [
  ...person.items.flatMap(item => item.threads
    .filter(thread => thread.kind === 'question')
    .flatMap(thread => thread.answers.filter(answer => answer.unreadByGiver))),
  ...person.suggestions.filter(suggestion => suggestion.unreadByGiver),
] : [];
export function unreadFood(food, person) {
  if (!food?.enabled) return [];
  return food.feed.flatMap(entry => [entry, ...entry.replies])
    .filter(entry => entry.seq > (person.foodReadSeq ?? 0) && entry.authorId !== person.id);
}

export function updatePreview(state, actor, action, fields, { id, now }) {
  const next = structuredClone(state);
  const me = next.people.find(person => person.id === actor);
  check(me);
  const recipient = next.people.find(person => person.id === me.recipient);
  const day = warsawDate.format(now);
  const ownItem = () => me.items.find(item => item.id === fields.item);
  const newIdea = input => ({ ...idea(input), id, createdAt: now.toISOString(), threads: [] });
  switch (action) {
    case 'visit':
      me.practicePinSet = true;
      break;
    case 'ack':
      break;
    case 'reveal':
      check(me.recipient && !me.revealed);
      me.revealed = true;
      break;
    case 'hint': {
      const { tab } = fields;
      check(['recipient', 'list', 'food', 'details'].includes(tab) && (tab !== 'food' || next.food?.enabled));
      me.hints ??= [];
      if (!me.hints.includes(tab)) me.hints.push(tab);
      break;
    }
    case 'add':
      check(me.state === 'open');
      me.items.push(newIdea(fields));
      break;
    case 'edit':
    case 'delete': {
      const item = ownItem();
      check(me.state === 'open' && item);
      check(ideaEditDeadline(item.createdAt) > now.getTime(), ideaEditExpired);
      if (action === 'edit') Object.assign(item, idea(fields));
      else me.items = me.items.filter(entry => entry !== item);
      break;
    }
    case 'strike': {
      const item = ownItem();
      check(me.state === 'open' && item && !item.strikeComment);
      const comment = String(fields.comment ?? '').replaceAll('\r\n', '\n').trim();
      check(comment.length > 0 && comment.length <= 500, 'Sprawdź długość wpisanego tekstu.', 'comment');
      item.strikeComment = comment;
      break;
    }
    case 'question': {
      const item = recipient?.items.find(item => item.id === fields.item);
      check(item && recipient.state === 'open' && !item.strikeComment);
      item.threads.push({ id, kind: 'question', question: text(fields.text, 700), createdAt: day, answers: [], unreadByOwner: true });
      break;
    }
    case 'reply': {
      const item = ownItem();
      check(item && me.state === 'open' && !item.strikeComment);
      const entry = { answer: value(fields.text, 1200), link: link(fields.link), createdAt: day };
      check(entry.answer || entry.link, 'Dodaj odpowiedź lub link.');
      const thread = item.threads.find(thread => thread.id === fields.thread && thread.kind === 'question');
      check(thread);
      thread.answers.push({ ...entry, id, unreadByGiver: true });
      break;
    }
    case 'read':
      for (const entry of unreadList(me)) delete entry.unreadByOwner;
      break;
    case 'read-giver':
      for (const entry of unreadGiver(recipient)) delete entry.unreadByGiver;
      break;
    case 'read-food':
      check(next.food?.enabled);
      me.foodReadSeq = next.food.seq;
      break;
    case 'suggest':
      check(maySuggest(recipient));
      recipient.suggestions.push({ ...newIdea(fields), createdAt: day, status: 'pending', unreadByOwner: true });
      break;
    case 'decide': {
      const suggestion = me.suggestions.find(suggestion => suggestion.id === fields.suggestion);
      check(me.state === 'open' && suggestion?.status === 'pending' && ['accepted', 'rejected'].includes(fields.decision));
      suggestion.status = fields.decision;
      suggestion.unreadByGiver = true;
      suggestion.comment = value(fields.comment, 500);
      if (fields.decision === 'accepted') me.items.push(newIdea(suggestion));
      break;
    }
    case 'mode':
      check(me.state === 'open' && ['unlimited', 'none'].includes(fields.mode));
      me.mode = fields.mode;
      if (me.mode === 'none') me.suggestions = me.suggestions.filter(suggestion => suggestion.status !== 'pending');
      break;
    case 'choice':
    case 'unlock': {
      const unlock = action === 'unlock';
      check(recipient && (unlock ? recipient.state !== 'open' : recipient.state === 'open'));
      recipient.state = unlock ? 'open' : 'selected';
      recipient.unlocked = unlock;
      break;
    }
    case 'food-add':
    case 'food-claim':
    case 'food-release':
    case 'food-comment':
    case 'food-reply': {
      const food = next.food;
      check(food?.enabled);
      const entry = { id, seq: ++food.seq, authorId: actor, authorName: me.name, createdAt: warsawDateTime.format(now), replies: [], text: '' };
      if (action === 'food-add') {
        check(food.allowProposals);
        const title = text(fields.title, 140);
        check(!food.items.some(item => item.title.toLocaleLowerCase('pl') === title.toLocaleLowerCase('pl')), 'Ta pozycja już jest na liście.');
        food.items.push({ id, title, claimedBy: null, organizerProvided: false });
        food.feed.push({ ...entry, kind: 'added', itemTitle: title });
      } else if (action === 'food-comment') {
        food.feed.push({ ...entry, kind: 'comment', text: text(fields.text, 1200) });
      } else if (action === 'food-reply') {
        const parent = food.feed.find(entry => entry.id === fields.entry);
        check(parent && !parent.replyOnly);
        parent.replies.push({ ...entry, text: text(fields.text, 1200) });
      } else {
        const item = food.items.find(item => item.id === fields.item);
        const claim = action === 'food-claim';
        check(item && !item.organizerProvided && (claim ? !item.claimedBy : item.claimedBy === actor));
        item.claimedBy = claim ? actor : null;
        food.feed.push({ ...entry, kind: claim ? 'claimed' : 'released', itemTitle: item.title });
      }
      break;
    }
    default:
      check(false);
  }
  recordMetric(next, me, action, fields, now);
  if (metricsChanged(state, next)) {
    const snapshot = metricsSnapshot(next, now);
    (next.snapshots ??= {})[snapshot.date] = snapshot;
  }
  return next;
}

function maySuggest(recipient) {
  return recipient?.state === 'open' && recipient.mode !== 'none';
}

const node = (tag, className, ...children) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.append(...children.filter(child => child != null && child !== false));
  return el;
};
const button = (label, onClick, style = '') => {
  const el = node('button', 'btn ' + style, label);
  el.type = 'button';
  el.addEventListener('click', onClick);
  return el;
};
const status = message => {
  const el = node('div', 'notice mt-sm', message);
  el.setAttribute('role', 'status');
  el.tabIndex = -1;
  return el;
};
const date = day => day ? node('time', 'entry-date tiny', day.slice(0, 10)) : null;
const ref = url => url ? node('p', 'small muted', url) : null;
const presentIdea = item => {
  const content = [node('span', 'gift-title', item.title), item.description && node('span', 'gift-desc multiline', item.description),
    item.price && node('span', 'gift-price', item.price)];
  return node('div', 'gift-main', ...(item.strikeComment ? [node('del', '', ...content)] : content), date(ideaCreationDay(item.createdAt)));
};
let textareaLimitSequence = 0;
function textareaHelp(input, id = 'preview-limit-' + ++textareaLimitSequence) {
  const help = node('p', 'small', textareaLimitText(input.value.length, input.maxLength));
  help.id = id;
  input.dataset.textareaLimit = id;
  input.setAttribute('aria-describedby', id);
  return help;
}
const field = (name, label, { max = 1200, initial = '', multiline = false, required = false, type = 'text' } = {}) => {
  const input = node(multiline ? 'textarea' : 'input');
  if (!multiline) input.type = type;
  input.name = name;
  input.value = initial;
  input.maxLength = max;
  input.required = required;
  input.autocomplete = 'off';
  if (!multiline) return [node('label', '', label, input), input];
  const help = textareaHelp(input);
  input.id = help.id + '-field';
  const caption = node('label', '', label);
  caption.htmlFor = input.id;
  return [node('div', '', caption, help, input), input];
};
function form(label, fields, submit, extra) {
  const error = node('p', 'error');
  error.setAttribute('role', 'alert');
  error.tabIndex = -1;
  const save = node('button', 'btn', label);
  save.type = 'submit';
  const el = node('form', 'form', ...fields.map(([wrapper]) => wrapper), extra, error, save);
  el.method = 'post';
  el.autocomplete = 'off';
  let invalidInput;
  el.addEventListener('submit', event => {
    event.preventDefault();
    invalidInput?.removeAttribute('aria-invalid');
    if (invalidInput?.dataset.textareaLimit) invalidInput.setAttribute('aria-describedby', invalidInput.dataset.textareaLimit);
    else invalidInput?.removeAttribute('aria-describedby');
    invalidInput = undefined;
    error.removeAttribute('id');
    error.textContent = '';
    try {
      submit(Object.fromEntries(new FormData(el)));
    } catch (err) {
      error.textContent = err.message;
      const [wrapper, input] = fields.find(([, field]) => field.name === err.field) ?? [];
      if (input) {
        invalidInput = input;
        error.id = 'preview-field-error';
        wrapper.before(error);
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', [error.id, input.dataset.textareaLimit].filter(Boolean).join(' '));
        input.focus();
      } else {
        save.before(error);
        error.focus();
      }
    }
  });
  return el;
}

function startPreview(data) {
  const main = document.querySelector('main');
  const banner = main.querySelector('.preview-notice');
  const reset = document.querySelector('[data-preview-reset]');
  const storage = (scope = data.scope) => previewStore(localStorage, new URL('.', location.href).pathname + scope, data.state);
  if (reset) {
    reset.addEventListener('click', () => {
      if (!confirm('Usunąć wszystkie próbne zmiany z tej przeglądarki?')) return;
      try {
        for (const scope of data.resetScopes) storage(scope).reset();
        reset.replaceWith(status('Usunięto próbne zmiany.'));
      } catch {
        banner.append(' Nie można wyczyścić danych w tej przeglądarce.');
      }
    });
  }
  if (data.view === 'metrics') {
    const report = main.querySelector('[data-metrics]');
    const initial = report.innerHTML;
    const renderMetrics = () => {
      try {
        const state = storage().read() ?? data.timeline;
        report.innerHTML = metricsContent(metricsReport(state, Object.values(state.snapshots ?? {})));
      } catch {
        banner.append(' Nie można odczytać próbnych zmian.');
      }
    };
    renderMetrics();
    window.addEventListener('pageshow', event => { if (event.persisted) renderMetrics(); });
    return;
  }
  if (data.practiceAction) {
    document.querySelector('[data-preview-practice-action]')?.addEventListener('click', () => {
      try {
        const local = storage();
        local.write(updatePreview(local.read(), data.actor, data.practiceAction, {}, { now: new Date() }));
      } catch {
        banner.append(' Nie można zapisać próbnych zmian.');
      }
    });
    if (data.practiceAction === 'visit') return;
  }
  if (!data.actor) return;
  const screen = main.querySelector('[data-preview-screen]');
  const hint = main.querySelector('[data-tab-hint]');
  let oldest = false;
  let openActivity = new Set();
  let currentForm;
  let state;
  try {
    state = storage().read();
  } catch {
    banner.append(' Zapis w tej przeglądarce jest niedostępny.');
    return;
  }
  const me = () => state.people.find(person => person.id === data.actor);
  const recipient = () => state.people.find(person => person.id === me().recipient);
  const pending = person => person.suggestions.filter(s => s.status === 'pending');
  const mark = (el, id, after) => {
    if (openActivity.has(id)) {
      el.classList.add('new-activity');
      const label = node('span', 'new-label', 'Nowe');
      if (after) after.after(label);
      else el.prepend(label);
      el.addEventListener('click', event => {
        if (event.target.closest?.('.new-activity, .feed-reply') !== el) return;
        openActivity.delete(id);
        el.classList.remove('new-activity');
        label.remove();
      }, true);
    }
    return el;
  };
  const badge = (view, count) => {
    const tab = document.querySelector(`[data-preview-tab="${view}"]`);
    if (!tab) return;
    tab.querySelector('.unread-count')?.remove();
    tab.querySelector('[data-preview-unread]')?.remove();
    if (!count || data.view === view) return;
    let icon = tab.querySelector('.nav-icon');
    if (!icon) {
      const svg = tab.querySelector('svg');
      icon = node('span', 'nav-icon');
      svg.replaceWith(icon);
      icon.append(svg);
    }
    const countEl = node('span', 'unread-count', count);
    countEl.setAttribute('aria-hidden', 'true');
    icon.append(countEl);
    const label = node('span', 'sr-only', ' — do przeczytania: ' + count);
    label.dataset.previewUnread = '';
    tab.append(label);
  };
  const commit = (action, fields = {}) => {
    const id = crypto.randomUUID();
    const next = updatePreview(storage().read(), data.actor, action, fields, { id, now: new Date() });
    try {
      storage().write(next);
    } catch {
      throw new Error('Nie udało się zapisać zmian w tej przeglądarce.');
    }
    state = next;
    return id;
  };
  if (hint) {
    const dismiss = hint.querySelector('[data-preview-dismiss-hint]');
    dismiss.disabled = false;
    dismiss.addEventListener('click', () => {
      try {
        commit('hint', { tab: hint.dataset.tabHint });
        hint.hidden = true;
        const heading = main.querySelector('h1');
        heading.tabIndex = -1;
        heading.focus();
      } catch (err) {
        banner.append(' ' + err.message);
      }
    });
  }
  measureBars();
  const announcement = node('p', 'sr-only');
  if (screen) {
    announcement.setAttribute('role', 'status');
    announcement.dataset.snackbarAnnouncement = '';
    screen.after(announcement);
  }
  const clearSnackbar = () => {
    screen.querySelector('.snackbar')?.remove();
    announcement.textContent = '';
  };
  const apply = (action, fields, message, target, after) => {
    clearSnackbar();
    const id = commit(action, fields);
    if (currentForm) {
      screen.hidden = false;
      currentForm.remove();
      currentForm = undefined;
    }
    render();
    const targetId = typeof target === 'function' ? target(id) : target;
    const result = document.getElementById(targetId);
    after?.(result);
    if (message) {
      const snackbar = node('p', 'snackbar', node('span', '', '✓'), ' ',
        node('span', '', typeof message === 'function' ? message(id) : message));
      screen.prepend(snackbar);
      showResult(result, snackbar, announcement);
    } else {
      result.tabIndex = -1;
      result.focus({ preventScroll: true });
      result.scrollIntoView({ block: 'nearest' });
    }
  };
  function openForm(title, fields, label, action, fixed, message, target, intro, extra, after, returnFocus) {
    const back = button('Wróć', () => {
      currentForm.remove();
      currentForm = undefined;
      screen.hidden = false;
      (returnFocus ?? screen.querySelector('button'))?.focus();
    }, 'quiet');
    const heading = node('h1', '', title);
    heading.tabIndex = -1;
    clearSnackbar();
    currentForm = node('div', '', back, heading, typeof intro === 'string' ? node('p', 'lead', intro) : intro,
      form(label, fields, values => apply(action, { ...values, ...fixed }, message, target, after), extra));
    screen.hidden = true;
    screen.after(currentForm);
    heading.focus();
    heading.scrollIntoView({ block: 'start' });
  }
  function ideaForm(action, item = {}, returnFocus) {
    const suggestion = action === 'suggest', edit = action === 'edit';
    const title = suggestion ? 'Zaproponuj pomysł' : edit ? 'Edytuj pomysł' : 'Dodaj pomysł';
    const fields = [
      field('title', 'Nazwa pomysłu', { max: 140, initial: item.title, required: true }),
      field('description', 'Opis (opcjonalnie)', { max: 1500, multiline: true, initial: item.description }),
      field('price', 'Szacowana cena (opcjonalnie)', { max: 100, initial: item.price }),
      field('link', 'Link (opcjonalnie)', { max: 2048, initial: item.link, type: 'url' }),
    ];
    openForm(title, fields, suggestion ? 'Wyślij propozycję' : edit ? 'Zapisz zmiany' : 'Dodaj', action,
      { item: item.id }, suggestion ? 'Wysłano propozycję.' : edit ? 'Zapisano zmiany.' : 'Dodano pomysł do listy.',
      suggestion ? 'suggestions' : id => 'item-' + (edit ? item.id : id),
      suggestion ? 'Zapytamy anonimowo, czy tej osobie podoba się Twój pomysł.' :
        node('div', '', node('p', 'lead', 'Osoba, która daje Ci prezent, zobaczy ten pomysł.'),
          !edit && node('p', 'mt-sm', ideaEditHint)), null,
      suggestion ? result => {
        const href = data.recipientList;
        if (!href) return;
        const view = node('a', 'btn secondary mt-sm', 'Zobacz, co widzi odbiorca');
        view.href = href + '#received-suggestion-' + recipient().suggestions.at(-1).id;
        result.firstElementChild.after(view);
      } : null, returnFocus);
  }
  function discuss(action, item, thread) {
    const question = action === 'question';
    const append = !question && thread.answers.length > 0;
    const input = field('text', question ? 'Treść pytania' : 'Odpowiedź', {
      multiline: true, required: question, max: question ? 700 : 1200,
    });
    const replyFields = question ? [] : [field('link', 'Link (opcjonalnie)', { max: 2048, type: 'url' })];
    const presets = question ? node('div', 'stack mt', ...data.presets.map(preset => button(preset, () => {
      input[1].value = preset;
      input[1].dispatchEvent(new Event('input', { bubbles: true }));
      input[1].focus();
    }, 'secondary'))) : null;
    const context = node('div', '', node('p', 'lead multiline', 'Pomysł: ', node('strong', '', item.title)),
      question ? node('p', '', recipient().name + ' nie zobaczy, kto pyta.')
        : node('p', 'multiline', 'Pytanie: ', thread.question),
      ...(append ? thread.answers.map(answer => node('div', 'answer', node('strong', '', 'Wcześniejsza odpowiedź:'),
        node('p', 'multiline', answer.answer), ref(answer.link), date(answer.createdAt))) : []));
    openForm(question ? 'O co chcesz dopytać?' : append ? 'Dopisz odpowiedź' : 'Twoja odpowiedź', [input, ...replyFields],
      question ? 'Wyślij anonimowo' : append ? 'Dopisz odpowiedź' : 'Wyślij odpowiedź', action,
      { item: item.id, thread: thread?.id }, question ? 'Wysłano pytanie.' : 'Zapisano odpowiedź.',
      'item-' + item.id, context, presets);
  }
  function gift(item, owner, person) {
    const writable = person.state === 'open';
    const struck = Boolean(item.strikeComment);
    const discussionOpen = writable && !struck;
    const ownActions = owner && writable;
    const remaining = ownActions ? ideaEditDeadline(item.createdAt) - Date.now() : 0;
    const editable = remaining > 0;
    const editState = (element, isOpen) => {
      element.setAttribute(isOpen ? 'data-idea-edit-open' : 'data-idea-edit-locked', '');
      element.hidden = isOpen !== editable;
      return element;
    };
    const editHint = text => {
      const icon = node('span', '', 'i');
      icon.setAttribute('aria-hidden', 'true');
      const hint = node('p', 'idea-edit-hint', icon, node('span', '', text));
      hint.setAttribute('role', 'note');
      return hint;
    };
    const lockedButton = (label, style) => {
      const control = node('button', 'btn ' + style, label);
      control.type = 'button';
      control.disabled = true;
      control.title = ideaEditExpired;
      return control;
    };
    const controls = ownActions ? [
      editable && editState(node('div', 'gift-actions', button('Edytuj', () => ideaForm('edit', item)),
        button('Usuń', () => openForm('Usunąć ten pomysł?', [], 'Tak, usuń', 'delete', { item: item.id }, 'Usunięto pomysł z listy.', 'list-result', item.title), 'danger-outline'),
        editHint(ideaEditHint)), true),
      editState(node('div', 'gift-actions', lockedButton('Edytuj', ''), lockedButton('Usuń', 'danger-outline'),
        editHint(ideaEditExpired)), false),
      !struck && node('div', 'gift-actions', button('Skreśl pomysł', event => openForm('Skreśl pomysł',
        [field('comment', 'Krótki komentarz', { max: 500, multiline: true, required: true })], 'Skreśl pomysł',
        'strike', { item: item.id }, 'Skreślono pomysł.', 'item-' + item.id,
        item.title + ' zostanie na liście jako skreślony. Osoba, która daje Ci prezent, zobaczy komentarz.',
        null, null, event.currentTarget))),
    ] : !owner && discussionOpen ? [node('div', 'gift-actions', button('Dopytaj anonimowo', () => discuss('question', item)))] : [];
    const closedComments = struck && node('div', 'gift-actions', node('p', 'discussion-closed', 'Pomysł nieaktualny, komentarze zamknięte'));
    const discussion = item.threads.map(thread => {
      const closed = struck ? ' closed-comment' : '';
      if (thread.kind === 'note') return node('div', 'item-note' + closed, node('strong', '', 'Komentarz'),
        node('p', 'multiline', thread.answer), ref(thread.link), date(thread.createdAt));
      const question = node('div', 'question' + closed, node('strong', '', owner ? 'Anonimowe pytanie:' : 'Twoje anonimowe pytanie:'),
        node('p', 'multiline', thread.question), date(thread.createdAt),
        ...thread.answers.map(answer => {
          const reply = node('div', 'answer', node('strong', '', 'Odpowiedź:'),
            node('p', 'multiline', answer.answer), ref(answer.link), date(answer.createdAt));
          return owner ? reply : mark(reply, answer.id, reply.firstElementChild);
        }),
        thread.answers.length ? null : node('p', 'question-status', 'Brak odpowiedzi'),
        owner && discussionOpen ? node('div', 'mt-sm', button(thread.answers.length ? 'Dopisz odpowiedź' : 'Odpowiedz',
          () => discuss('reply', item, thread))) : null);
      return owner ? mark(question, thread.id, question.firstElementChild) : question;
    });
    const strikeNote = struck && node('div', 'item-note', node('strong', '', 'Pomysł skreślony'), node('p', 'multiline', item.strikeComment));
    const card = node('article', 'gift-card', presentIdea(item), node('div', 'gift-details', ref(item.link), strikeNote, ...discussion), ...controls, closedComments);
    if (editable) card.dataset.ideaEditRemaining = remaining;
    card.id = 'item-' + item.id;
    return card;
  }
  const cards = (person, owner, empty) => node('div', 'stack mt-sm',
    ...(person.items.length ? person.items.map(item => gift(item, owner, person)) : [node('div', 'empty', empty)]));
  function suggestions(person, owner) {
    const entries = owner ? pending(person) : person.suggestions;
    const section = node('section', 'section-gap', node('h2', '', owner ? 'Propozycje od osoby, która daje Ci prezent' : 'Twoje propozycje'));
    section.id = owner ? 'received-suggestions' : 'suggestions';
    if (owner) {
      section.firstElementChild.id = 'suggestion-result';
      section.append(node('p', 'small mt-sm', 'Czy podoba Ci się ten pomysł?'));
    }
    else if (maySuggest(person)) section.append(
      node('p', 'small mt-sm', 'Możesz anonimowo zapytać, czy Twój pomysł się podoba.'),
      node('div', 'mt-sm', button('Zaproponuj pomysł', () => ideaForm('suggest'))),
    );
    else if (person.state === 'open') section.append(node('div', 'notice mt-sm',
      node('h3', '', 'Ta osoba nie przyjmuje teraz propozycji.'), node('p', '', 'Oczekujące propozycje usunięto.')));
    section.append(node('div', 'stack mt-sm', ...entries.map(entry => {
      const card = node('article', 'suggestion-box', presentIdea(entry), ref(entry.link));
      if (!owner) {
        const label = entry.status === 'accepted' ? 'Przyjęta' : entry.status === 'rejected' ? 'Odrzucona' :
          person.state === 'open' ? 'Czeka na odpowiedź' : 'Odpowiedź wstrzymana — lista jest zablokowana';
        card.append(node('strong', 'suggestion-status ' + entry.status, label));
        if (entry.comment) card.append(node('p', 'response-comment multiline', entry.comment));
      } else {
        card.id = 'received-suggestion-' + entry.id;
        card.tabIndex = -1;
        card.append(node('div', 'action-row', ...['accepted', 'rejected'].map(decision => {
          const accept = decision === 'accepted';
          const label = accept ? 'Podoba mi się' : 'Nie, dziękuję';
          return button(label, () => openForm(accept ? 'Podoba Ci się ten pomysł?' : 'Odrzucić propozycję?',
            [field('comment', 'Krótki komentarz (opcjonalnie)', { multiline: true, max: 500 })], label, 'decide',
            { suggestion: entry.id, decision }, accept ? 'Dodano propozycję do listy.' : 'Odrzucono propozycję.',
            id => accept ? 'item-' + id : 'suggestion-result',
            entry.title, accept ? node('p', 'notice', 'Pomysł trafi na Twoją listę. To nie znaczy, że dostaniesz właśnie ten prezent.') : null));
        })));
      }
      return mark(card, entry.id);
    })));
    return section;
  }
  function list() {
    const person = me(), open = person.state === 'open';
    const title = node('h1', '', data.title);
    title.id = 'list-result';
    const intro = node('p', 'lead', 'Podpowiedz, co chcesz dostać.');
    const stateNote = open ? (person.unlocked && node('div', 'notice mt', node('h3', '', 'Twoja lista jest znowu odblokowana.'))) :
      node('div', 'notice mt', node('h3', '', 'Prezent dla Ciebie jest już wybrany'), 'Lista, pytania i komentarze są tylko do odczytu.');
    const question = 'Czy przyjmujesz propozycje prezentów?';
    const savedMode = person.mode === 'none' ? 'none' : 'unlimited';
    const settings = node('fieldset', 'form-group preference-options', node('legend', '', question));
    for (const [mode, label] of [['unlimited', 'Tak'], ['none', 'Nie']]) {
      const input = node('input');
      input.type = 'radio';
      input.name = 'mode';
      input.value = mode;
      input.checked = savedMode === mode;
      settings.append(node('label', '', input, node('span', '', label)));
    }
    const preferences = form('Zapisz ustawienie', [], fields => {
      const count = pending(person).length;
      if (fields.mode === 'none' && count) {
        const removalNotice = 'Usunięto te, które czekały na odpowiedź.';
        openForm('Przestać przyjmować propozycje?', [], 'Tak, nie przyjmuję propozycji', 'mode', fields,
          'Nie przyjmujesz propozycji. ' + removalNotice, 'suggestion-settings-result',
          `Propozycje czekające na odpowiedź: ${count}. Zostaną usunięte bez odpowiedzi.`, null,
          result => result.after(node('p', 'notice', removalNotice)), preferences.querySelector('button'));
      } else apply('mode', fields, fields.mode === 'none' ? 'Nie przyjmujesz propozycji.' : 'Zapisano ustawienie propozycji.', 'suggestion-settings-result');
    }, settings);
    preferences.classList.add('preference');
    preferences.querySelector('button').classList.add('secondary');
    const modeResult = node('details', 'disclosure',
      node('summary', '', question + (savedMode === 'none' ? ' Nie' : ' Tak')), preferences);
    modeResult.id = 'suggestion-settings-result';
    const optionPanel = node('section', '', modeResult);
    optionPanel.id = 'suggestion-settings';
    const addIdea = open && node('div', 'mt', button('Dodaj pomysł', event => ideaForm('add', {}, event.currentTarget)));
    if (addIdea && !pending(person).length) addIdea.id = 'suggestion-result';
    return [title, intro, stateNote,
      open && person.items.length < 2 && node('p', 'mt-sm', 'Dodaj 2 lub 3 pomysły, wtedy trudniej zgadnąć, co dostaniesz.'),
      cards(person, true, 'Twoja lista jest pusta. Jeśli chcesz, dodaj pierwszy pomysł.'), !person.items.length && addIdea,
      open && pending(person).length && suggestions(person, true),
      person.items.length > 0 && addIdea, open && optionPanel];
  }
  function draw() {
    const person = recipient();
    const title = node('h1', 'recipient-title', node('span', 'task', 'Robisz prezent dla:'), node('span', 'recipient-name', person.name));
    const section = node('section', 'section-gap', node('h2', 'list-heading', 'Lista pomysłów'),
      cards(person, false, `${person.name} nie ma jeszcze widocznych pomysłów. Możesz dać prezent według własnego pomysłu.`));
    const choice = node('section', 'choice-panel section-gap');
    choice.id = 'choice';
    const change = (action, label, message, style) => button(label, event => {
      try {
        apply(action, {}, message, 'choice');
      } catch (error) {
        event.currentTarget.after(status(error.message));
      }
    }, style);
    if (person.state === 'open') choice.append(node('h2', '', 'Wiesz już, co dasz?'),
      node('p', '', 'Gdy wiesz, co dasz, dotknij „Wiem, co dam”. Lista i rozmowy będą tylko do odczytu, a propozycje zostaną wstrzymane. Możesz odblokować listę. Nie zapisujemy, co wybierasz.'),
      node('div', 'mt-sm', change('choice', 'Wiem, co dam', null)));
    else choice.append(node('h2', '', 'Wiesz, co dasz'), node('p', '', 'Gotowe. Możesz zamknąć aplikację.'),
      node('div', 'mt-sm', change('unlock', 'Zmieniam zdanie, odblokuj listę', 'Lista odblokowana.', 'quiet')));
    return [title, person.state === 'open' && node('p', 'lead', 'Lista to podpowiedzi. Możesz też dać coś spoza listy.'),
      person.state !== 'open' && choice, section, person.state === 'open' && choice, suggestions(person, false)];
  }
  function food() {
    const food = state.food;
    const list = node('section', 'mt');
    list.id = 'food-list';
    const dishes = food.items.map(dish => {
      const mine = dish.claimedBy === data.actor;
      const name = state.people.find(person => person.id === dish.claimedBy)?.name;
      const label = dish.organizerProvided ? 'Zapewnia organizator' : name ? 'Zajęte: ' + name + (mine ? ' (Ty)' : '') : 'Wolne';
      const type = dish.organizerProvided ? 'organizer' : mine ? 'mine' : name ? 'claimed' : 'free';
      const row = node('div', 'food-row', node('div', 'food-info', node('strong', 'food-title', dish.title), node('span', 'food-status ' + type, label)));
      const article = node('article', 'food-item', row);
      article.id = 'food-item-' + dish.id;
      if (!dish.organizerProvided && (mine || !name)) row.append(node('div', 'food-action', button(mine ? 'Zrezygnuj' : 'Zrobię to', () => {
        try {
          apply(mine ? 'food-release' : 'food-claim', { item: dish.id },
            mine ? `Znów wolne: ${dish.title}.` : `Zarezerwowano: ${dish.title}.`, article.id);
        } catch (error) {
          row.after(status(error.message));
        }
      }, mine ? 'secondary food-btn' : 'food-btn')));
      return article;
    });
    list.append(node('div', 'stack mt-sm', ...dishes));
    if (food.allowProposals) list.append(form('Dodaj pozycję', [field('title', 'Dodaj nową pozycję do listy', { max: 140, required: true })],
      values => apply('food-add', values, id => `Dodano danie: ${state.food.items.find(dish => dish.id === id).title}.`,
        id => 'food-item-' + id)));
    const sort = node('div', 'sort-toggle', ...[false, true].map(asc => {
      const btn = node('button', 'sort-link' + (oldest === asc ? ' active' : ''), asc ? 'Od najstarszych' : 'Od najnowszych');
      btn.type = 'button';
      if (oldest === asc) btn.setAttribute('aria-current', 'true');
      btn.addEventListener('click', () => {
        oldest = asc;
        render();
        document.querySelector('.sort-link.active').focus();
      });
      return btn;
    }));
    const feed = node('section', 'section-gap', node('div', 'feed-header', node('h2', '', 'Komentarze i wydarzenia'), sort));
    feed.id = 'food-feed';
    const composer = (formClass, inputId, labelText, placeholder, btnClass, onSubmit, srOnly = false) => {
      const lbl = node('label', srOnly ? 'sr-only' : '', labelText);
      lbl.htmlFor = inputId;
      const input = node('textarea');
      input.id = inputId;
      input.name = 'text';
      input.rows = 1;
      input.required = true;
      input.maxLength = 1200;
      input.placeholder = placeholder;
      input.autocomplete = 'off';
      const save = node('button', 'btn ' + btnClass, 'Wyślij');
      save.type = 'submit';
      const error = node('p', 'error');
      error.setAttribute('role', 'alert');
      error.tabIndex = -1;
      const help = textareaHelp(input, inputId + '-limit');
      const el = node('form', formClass, lbl, !srOnly && node('p', 'small muted', 'Komentarze widzą wszyscy uczestnicy.'),
        help, node('div', 'composer-row', input, save), error);
      el.method = 'post';
      el.autocomplete = 'off';
      el.addEventListener('submit', event => {
        event.preventDefault();
        try {
          onSubmit(Object.fromEntries(new FormData(el)));
        } catch (err) {
          error.textContent = err.message;
          error.focus();
        }
      });
      return el;
    };
    const when = stamp => stamp && node('time', 'entry-date tiny', stamp);
    const head = entry => node('div', 'feed-head', node('strong', '', entry.authorName || 'Organizator'), when(entry.createdAt));
    const eventCopy = {
      added: ['dodaje:', ''], claimed: ['bierze:', ''], released: ['rezygnuje z:', ' (wolne)'],
      removed: ['usuwa:', ''],
    };
    const entries = oldest ? food.feed : food.feed.toReversed();
    feed.append(composer('composer mt-sm', 'comment-text', 'Dodaj komentarz', 'Komentarz…', 'composer-btn',
      values => apply('food-comment', values, 'Dodano komentarz.', id => 'food-entry-' + id)), node('div', 'feed-list mt', ...entries.map(entry => {
      const copy = eventCopy[entry.kind];
      const article = node('article', 'feed-entry ' + (copy ? 'feed-event-row' : 'feed-comment'));
      article.id = 'food-entry-' + entry.id;
      const replies = entry.replies.length ? node('div', 'feed-replies',
        ...entry.replies.map(reply => {
          const header = head(reply);
          return mark(node('div', 'feed-reply', header, node('p', 'multiline', reply.text)), reply.id, header.firstElementChild);
        })) : null;
      const replyBox = entry.replyOnly ? null : node('details', 'reply-box', node('summary', 'reply-toggle', node('span', '', 'Odpowiedz')),
        composer('reply-form', 'reply-' + entry.id, 'Odpowiedź', 'Odpowiedź…', 'secondary composer-btn',
          values => apply('food-reply', { ...values, entry: entry.id }, 'Dodano odpowiedź.', article.id), true));
      if (copy) {
        const line = node('div', 'feed-event-line', node('p', 'feed-event', node('strong', '', entry.authorName || 'Organizator'),
          ' ' + copy[0] + ' ', node('strong', '', entry.itemTitle), copy[1]));
        article.append(line);
        if (replies) article.append(when(entry.createdAt), replies, replyBox);
        else article.append(node('div', 'feed-meta', when(entry.createdAt), replyBox));
        return mark(article, entry.id, line.firstElementChild);
      } else {
        const header = head(entry);
        article.append(header, node('p', 'multiline feed-body', entry.text));
        if (replies) article.append(replies);
        if (replyBox) article.append(replyBox);
        return mark(article, entry.id, header.firstElementChild);
      }
    })));
    return [node('h1', '', data.title), node('p', 'lead', 'Lista potraw na spotkanie. Każdy widzi, kto co przygotowuje.'), list, feed];
  }
  let stopEditTimers;
  function render() {
    const view = { list, recipient: draw, food }[data.view];
    if (hint) hint.hidden = me().hints?.includes(hint.dataset.tabHint) ?? false;
    if (screen && view) {
      stopEditTimers?.();
      screen.replaceChildren(...[hint, ...view()].filter(Boolean));
      stopEditTimers = watchIdeaEditWindows(screen);
    }
    announcement.textContent = '';
    badge('list', unreadList(me()).length);
    badge('recipient', unreadGiver(recipient()).length);
    badge('food', unreadFood(state.food, me()).length);
  }
  function openUnread() {
    const [entries, action] = data.view === 'list' ? [unreadList(me()), 'read'] :
      data.view === 'recipient' ? [unreadGiver(recipient()), 'read-giver'] :
        data.view === 'food' ? [unreadFood(state.food, me()), 'read-food'] : [[], null];
    openActivity = new Set(entries.map(entry => entry.id));
    if (openActivity.size) {
      try {
        commit(action);
      } catch {
        banner.append(' Nie można oznaczyć zmian jako przeczytane.');
      }
    }
  }
  openUnread();
  if (state.food?.enabled && data.view !== 'food') {
    const local = storage();
    window.addEventListener('storage', event => {
      if (event.storageArea !== localStorage || (event.key !== local.key && event.key !== null)) return;
      try {
        const latest = local.read();
        badge('food', unreadFood(latest.food, latest.people.find(person => person.id === data.actor)).length);
      } catch {
        // Keep the current badge if preview storage cannot be read.
      }
    });
  }
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    try {
      state = storage().read();
      openUnread();
      render();
    } catch {
      banner.append(' Nie można odczytać próbnych zmian.');
    }
  });
  render();
  if (location.hash.startsWith('#received-suggestion-')) {
    const target = document.getElementById(location.hash.slice(1));
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'start' });
  }
}

if (typeof document !== 'undefined') {
  watchTextareaLimits(document);
  keepEditingFieldVisible();
  trackFocusModality();
  previewHomeScreen();
  const metadata = document.querySelector('meta[name="preview-data"]');
  if (metadata) startPreview(JSON.parse(metadata.content));
}
