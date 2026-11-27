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
  purchase: 'Oznaczenia zakupu prezentu',
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

export function summarizeMetrics(event) {
  const { people } = event;
  const peopleInState = state => people.filter(p => p.state === state).length;
  const visitCounts = people.map(p => p.metrics?.visits ?? 0);
  const features = Object.entries(featureLabels)
    .filter(([key]) => !key.startsWith('food-') || event.food?.enabled || event.metrics?.totals[key])
    .map(([key, label]) => ({
      label, total: event.metrics?.totals[key] ?? 0, people: people.filter(p => p.metrics?.used.includes(key)).length,
    }));
  return {
    participants: people.length,
    entered: visitCounts.filter(n => n > 0).length,
    pins: people.filter(p => p.pin || p.practicePinSet).length,
    revealed: people.filter(p => p.revealed).length,
    lists: people.filter(p => p.items.length > 0).length,
    chosen: peopleInState('selected') + peopleInState('bought'),
    purchased: peopleInState('bought'),
    features,
    days: Object.entries(event.metrics?.days ?? {}).sort(([a], [b]) => b.localeCompare(a))
      .map(([date, { visits, actions }]) => ({ date, visits, actions })),
    distribution: people.length < 5 ? null : [
      ['0', visitCounts.filter(n => n === 0).length],
      ['1', visitCounts.filter(n => n === 1).length],
      ['2–5', visitCounts.filter(n => n >= 2 && n <= 5).length],
      ['6+', visitCounts.filter(n => n >= 6).length],
    ],
  };
}

const metricNumber = n => Number.isSafeInteger(n) && n >= 0 ? n : 0;
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

export function metricsContent(summary) {
  const { participants, entered, pins, revealed, lists, chosen, purchased, features, days, distribution } = summary;
  const dailyRows = days.filter(({ date }) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .map(({ date, visits, actions }) => [date, visits, actions]);
  const mostVisits = dailyRows.reduce((max, [, visits]) => Math.max(max, metricNumber(visits)), 0);
  return `<section class="section-gap" aria-labelledby="metrics-progress"><h2 id="metrics-progress">Postępy</h2>
<p class="mt-sm">Pełny pasek oznacza wszystkich uczestników.</p>
${metricsFacts([['Uczestnicy', participants], ['Weszli na swoje konto', entered, participants],
    ['Mają ustawiony PIN', pins, participants], ['Odkryli wynik losowania', revealed, participants],
    ['Mają co najmniej jeden pomysł', lists, participants], ['Wiedzą, co dadzą', chosen, participants],
    ['Oznaczyli prezent jako kupiony', purchased, participants]])}</section>
<section class="section-gap" aria-labelledby="metrics-visits"><h2 id="metrics-visits">Wejścia na konto</h2>
<p class="mt-sm">Wejście liczy się po poprawnym PIN-ie lub po otwarciu wspólnego linku na zapamiętanym urządzeniu.</p>
${distribution ? metricsTable(['Liczba wejść', 'Osoby'], distribution, participants) :
    '<p class="notice mt-sm">Podział wejść jest widoczny od 5 uczestników.</p>'}</section>
<section class="section-gap" aria-labelledby="metrics-daily"><h2 id="metrics-daily">Aktywność według dni</h2>
${dailyRows.length ? '<p class="mt-sm">Pełny pasek oznacza dzień z największą liczbą wejść.</p>' +
    metricsTable(['Dzień', 'Wejścia', 'Akcje'], dailyRows, mostVisits) : '<p class="mt-sm">Nie odnotowano jeszcze aktywności.</p>'}</section>
<section class="section-gap" aria-labelledby="metrics-features"><h2 id="metrics-features">Użycie funkcji</h2>
<p class="mt-sm">„Osoby” to liczba obecnych uczestników, którzy użyli danej funkcji.</p>
${metricsTable(['Funkcja', 'Użycia', 'Osoby'], features.map(({ label, total, people }) => [label, total, people]))}</section>`;
}


const storagePrefix = 'upominki-preview:';
const warsawDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', dateStyle: 'short' });
const warsawDateTime = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', dateStyle: 'short', timeStyle: 'short' });

export function previewStore(storage, scope, initial) {
  const key = storagePrefix + scope;
  return {
    read: () => JSON.parse(storage.getItem(key) ?? 'null') ?? structuredClone(initial),
    write: state => storage.setItem(key, JSON.stringify(state)),
    reset: () => storage.removeItem(key),
  };
}

const check = (condition, message = 'Ta czynność nie jest teraz dostępna.') => {
  if (!condition) throw new Error(message);
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
  const newIdea = input => ({ ...idea(input), id, createdAt: day, threads: [] });
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
      check(me.state === 'open' && ownItem());
      Object.assign(ownItem(), idea(fields));
      break;
    case 'delete':
      check(me.state === 'open' && ownItem());
      me.items = me.items.filter(item => item.id !== fields.item);
      break;
    case 'question': {
      const item = recipient?.items.find(item => item.id === fields.item);
      check(item && recipient.state !== 'bought');
      item.threads.push({ id, kind: 'question', question: text(fields.text, 700), createdAt: day, answers: [], unreadByOwner: true });
      break;
    }
    case 'reply':
    case 'note': {
      const item = ownItem();
      check(item && me.state !== 'bought');
      const entry = { answer: value(fields.text, 1200), link: link(fields.link), createdAt: day };
      check(entry.answer || entry.link, 'Dodaj odpowiedź, komentarz lub link.');
      if (action === 'note') item.threads.push({ id, kind: 'note', ...entry });
      else {
        const thread = item.threads.find(thread => thread.id === fields.thread && thread.kind === 'question');
        check(thread);
        thread.answers.push({ ...entry, id, unreadByGiver: true });
      }
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
      recipient.suggestions.push({ ...newIdea(fields), status: 'pending', unreadByOwner: true });
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
      check(me.state === 'open' && ['unlimited', 'single', 'none'].includes(fields.mode));
      me.mode = fields.mode;
      if (me.mode === 'none') me.suggestions = me.suggestions.filter(suggestion => suggestion.status !== 'pending');
      break;
    case 'choice':
    case 'unlock':
    case 'purchase': {
      const [before, after] = { choice: ['open', 'selected'], unlock: ['selected', 'open'], purchase: ['selected', 'bought'] }[action];
      check(recipient?.state === before);
      recipient.state = after;
      recipient.unlocked = action === 'unlock';
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
        check(parent);
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
  return next;
}

function maySuggest(recipient) {
  return recipient?.state === 'open' && recipient.mode !== 'none' &&
    (recipient.mode !== 'single' || recipient.suggestions.every(suggestion => suggestion.status !== 'pending'));
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
const presentIdea = item => node('div', 'gift-main',
  node('span', 'gift-title', item.title), item.description && node('span', 'gift-desc multiline', item.description),
  item.price && node('span', 'gift-price', item.price), date(item.createdAt));
const field = (name, label, { max = 1200, initial = '', multiline = false, required = false, type = 'text' } = {}) => {
  const input = node(multiline ? 'textarea' : 'input');
  if (!multiline) input.type = type;
  input.name = name;
  input.value = initial;
  input.maxLength = max;
  input.required = required;
  input.autocomplete = 'off';
  return [node('label', '', label, input), input];
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
  el.addEventListener('submit', event => {
    event.preventDefault();
    try {
      submit(Object.fromEntries(new FormData(el)));
    } catch (err) {
      error.textContent = err.message;
      error.focus();
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
        const state = storage().read();
        report.innerHTML = state ? metricsContent(summarizeMetrics(state)) : initial;
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
  const apply = (action, fields, message, target, { afterReplies = false } = {}) => {
    const id = commit(action, fields);
    if (currentForm) {
      screen.hidden = false;
      currentForm.remove();
      currentForm = undefined;
    }
    render();
    const result = status(message);
    const targetId = typeof target === 'function' ? target(id) : target;
    const container = targetId && document.getElementById(targetId) || screen;
    const anchor = afterReplies && container.querySelector('.reply-box');
    if (anchor) anchor.before(result);
    else container.prepend(result);
    result.focus();
    result.scrollIntoView({ block: 'nearest' });
    return result;
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
    currentForm = node('div', '', back, heading, typeof intro === 'string' ? node('p', 'lead', intro) : intro, form(label, fields, values => {
      const result = apply(action, { ...values, ...fixed }, message, target);
      after?.(result);
    }, extra));
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
      suggestion ? 'suggestions' : edit ? 'item-' + item.id : null,
      suggestion ? 'Zapytamy anonimowo, czy tej osobie podoba się Twój pomysł.' : 'Osoba, która daje Ci prezent, zobaczy ten pomysł.', null,
      suggestion ? result => {
        const href = data.recipientList;
        if (!href) return;
        const view = node('a', 'btn secondary mt-sm', 'Zobacz, co widzi odbiorca');
        view.href = href + '#received-suggestion-' + recipient().suggestions.at(-1).id;
        result.after(view);
      } : null, returnFocus);
  }
  function discuss(action, item, thread) {
    const question = action === 'question', reply = action === 'reply';
    const append = reply && thread.answers.length > 0;
    const input = field('text', question ? 'Treść pytania' : reply ? 'Odpowiedź' : 'Komentarz', {
      multiline: true, required: question, max: question ? 700 : 1200,
    });
    const replyFields = question ? [] : [field('link', 'Link (opcjonalnie)', { max: 2048, type: 'url' })];
    const presets = question ? node('div', 'stack mt', ...data.presets.map(preset => button(preset, () => {
      input[1].value = preset;
      input[1].focus();
    }, 'secondary'))) : null;
    const context = node('div', '', node('p', 'lead multiline', 'Pomysł: ', node('strong', '', item.title)),
      question ? node('p', '', recipient().name + ' nie zobaczy, kto pyta.')
        : reply ? node('p', 'multiline', 'Pytanie: ', thread.question)
          : node('p', '', 'To komentarz do pomysłu, nie odpowiedź na pytanie. Zobaczy go osoba, która daje Ci prezent.'),
      ...(append ? thread.answers.map(answer => node('div', 'answer', node('strong', '', 'Wcześniejsza odpowiedź:'),
        node('p', 'multiline', answer.answer), ref(answer.link), date(answer.createdAt))) : []));
    openForm(question ? 'O co chcesz dopytać?' : append ? 'Dopisz odpowiedź' : reply ? 'Twoja odpowiedź' : 'Skomentuj', [input, ...replyFields],
      question ? 'Wyślij anonimowo' : append ? 'Dopisz odpowiedź' : reply ? 'Wyślij odpowiedź' : 'Zapisz komentarz', action,
      { item: item.id, thread: thread?.id }, question ? 'Wysłano pytanie.' : reply ? 'Zapisano odpowiedź.' : 'Zapisano komentarz.',
      'item-' + item.id, context, presets);
  }
  function gift(item, owner, person) {
    const open = person.state === 'open', writable = person.state !== 'bought';
    const controls = [
      owner && open && button('Edytuj', () => ideaForm('edit', item)),
      owner && open && button('Usuń', () => openForm('Usunąć ten pomysł?', [], 'Tak, usuń', 'delete', { item: item.id }, 'Usunięto pomysł z listy.', null, item.title), 'danger-outline'),
      owner && writable && button('Skomentuj', () => discuss('note', item), 'quiet'),
      !owner && writable && button('Zapytaj anonimowo', () => discuss('question', item)),
    ].filter(Boolean);
    const discussion = item.threads.map(thread => {
      if (thread.kind === 'note') return node('div', 'item-note', node('strong', '', 'Komentarz'),
        node('p', 'multiline', thread.answer), ref(thread.link), date(thread.createdAt));
      const question = node('div', 'question', node('strong', '', owner ? 'Anonimowe pytanie:' : 'Twoje anonimowe pytanie:'),
        node('p', 'multiline', thread.question), date(thread.createdAt),
        ...thread.answers.map(answer => {
          const reply = node('div', 'answer', node('strong', '', 'Odpowiedź:'),
            node('p', 'multiline', answer.answer), ref(answer.link), date(answer.createdAt));
          return owner ? reply : mark(reply, answer.id, reply.firstElementChild);
        }),
        thread.answers.length ? null : node('p', 'question-status', 'Brak odpowiedzi'),
        owner && writable ? node('div', 'mt-sm', button(thread.answers.length ? 'Dopisz odpowiedź' : 'Odpowiedz',
          () => discuss('reply', item, thread))) : null);
      return owner ? mark(question, thread.id, question.firstElementChild) : question;
    });
    const card = node('article', 'gift-card', presentIdea(item), node('div', 'gift-details', ref(item.link), ...discussion),
      controls.length ? node('div', 'gift-actions', ...controls) : null);
    card.id = 'item-' + item.id;
    return card;
  }
  const cards = (person, owner, empty) => node('div', 'stack mt-sm',
    ...(person.items.length ? person.items.map(item => gift(item, owner, person)) : [node('div', 'empty', empty)]));
  function suggestions(person, owner) {
    const entries = owner ? pending(person) : person.suggestions;
    const section = node('section', 'section-gap', node('h2', '', owner ? 'Propozycje od osoby, która daje Ci prezent' : 'Twoje propozycje'));
    section.id = owner ? 'received-suggestions' : 'suggestions';
    if (owner) section.append(node('p', 'small mt-sm', 'Czy podoba Ci się ten pomysł?'));
    else if (maySuggest(person)) section.append(node('div', 'mt-sm', button('Zaproponuj pomysł', () => ideaForm('suggest'))));
    else if (person.state === 'open') section.append(node('p', 'notice', person.mode === 'none'
      ? 'Ta osoba nie przyjmuje teraz propozycji.' : 'Poczekaj na odpowiedź przed wysłaniem kolejnej propozycji.'));
    section.append(node('div', 'stack mt-sm', ...entries.map(entry => {
      const card = node('article', 'suggestion-box', presentIdea(entry), ref(entry.link));
      if (!owner) {
        const label = entry.status === 'accepted' ? 'Przyjęta' : entry.status === 'rejected' ? 'Odrzucona' :
          person.state === 'selected' ? 'Odpowiedź wstrzymana — lista jest zablokowana' :
            person.state === 'bought' ? 'Zamknięta bez odpowiedzi' : 'Czeka na odpowiedź';
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
            id => accept ? 'item-' + id : pending(me()).length ? 'received-suggestions' : 'suggestion-result',
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
    const intro = node('p', 'lead', 'Podpowiedz, co chcesz dostać.');
    const stateNote = open ? (person.unlocked ? 'Twoja lista jest znowu odblokowana.' : '') :
      person.state === 'selected' ? 'Twoja lista jest zablokowana. Nadal możesz odpowiadać na pytania i dodawać komentarze.' :
        'Prezent dla Ciebie jest już kupiony. Teraz czekamy na święta.';
    const settings = node('fieldset', 'form-group preference-options', node('legend', '', 'Czy przyjmujesz propozycje prezentów?'));
    for (const [mode, label] of [['unlimited', 'Tak, bez limitu'], ['single', 'Tak, po jednej'], ['none', 'Nie przyjmuję']]) {
      const input = node('input');
      input.type = 'radio';
      input.name = 'mode';
      input.value = mode;
      input.checked = person.mode === mode;
      settings.append(node('label', '', input, node('span', '', label)));
    }
    const preferences = form('Zapisz ustawienie', [], fields => {
      if (fields.mode === 'none' && pending(person).length) {
        openForm('Przestać przyjmować propozycje?', [], 'Tak, nie przyjmuję propozycji', 'mode', fields, 'Zapisano ustawienie propozycji.',
          'suggestion-settings', `Propozycje czekające na odpowiedź: ${pending(person).length}. Zostaną usunięte bez odpowiedzi.`);
      } else apply('mode', fields, 'Zapisano ustawienie propozycji.', 'suggestion-settings');
    }, settings);
    const optionPanel = node('section', 'section-gap', preferences);
    optionPanel.id = 'suggestion-settings';
    const suggestionResult = node('div');
    suggestionResult.id = 'suggestion-result';
    return [title, intro, stateNote && node('p', 'notice mt', stateNote),
      open && person.items.length < 2 && node('p', 'mt-sm', 'Dodaj 2 lub 3 pomysły, wtedy trudniej zgadnąć, co dostaniesz.'),
      cards(person, true, 'Twoja lista jest pusta.'), open && (pending(person).length ? suggestions(person, true) : suggestionResult),
      open && optionPanel, open && node('div', 'mt', button('Dodaj pomysł', event => ideaForm('add', {}, event.currentTarget)))];
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
      node('p', '', 'Gdy wiesz, co dasz, dotknij „Wiem, co dam”. Lista zostanie zablokowana, a propozycje zamknięte. Możesz ją później odblokować. Nie zapisujemy, co wybierasz.'),
      node('div', 'mt-sm', change('choice', 'Wiem, co dam', 'Lista zablokowana.')));
    else if (person.state === 'selected') choice.append(node('h2', '', 'Wiesz, co dasz'), node('p', '', 'Gotowe. Możesz zamknąć aplikację.'),
      node('div', 'stack mt-sm', change('unlock', 'Zmieniam zdanie, odblokuj listę', 'Lista odblokowana.', 'quiet'),
        button('Oznacz prezent jako kupiony', () => openForm('Oznaczyć prezent jako kupiony?', [], 'Tak, prezent jest kupiony',
          'purchase', {}, 'Prezent, który dasz, jest już kupiony.', 'choice',
          'To opcjonalne. Tego nie da się cofnąć. Lista, pytania i komentarze zamkną się dla Was obojga.'))));
    else choice.append(node('h2', '', 'Prezent, który dasz, jest już kupiony.'), node('p', '', 'Teraz czekamy na święta.'));
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
            mine ? 'Zrezygnowano — pozycja jest znowu wolna.' : 'Zapisano: bierzesz tę pozycję.', article.id);
        } catch (error) {
          row.after(status(error.message));
        }
      }, mine ? 'secondary food-btn' : 'food-btn')));
      return article;
    });
    list.append(node('div', 'stack mt-sm', ...dishes));
    if (food.allowProposals) list.append(form('Dodaj pozycję', [field('title', 'Dodaj nową pozycję do listy', { max: 140, required: true })],
      values => apply('food-add', values, 'Dodano pozycję do listy.', 'food-list')));
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
      const el = node('form', formClass, lbl, !srOnly && node('p', 'small muted', 'Komentarze widzą wszyscy uczestnicy.'),
        node('div', 'composer-row', input, save), error);
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
      'organizer-provided': ['przejmuje:', ' (zapewnia organizator)'], opened: ['udostępnia do wzięcia:', ''], removed: ['usuwa:', ''],
    };
    const entries = oldest ? food.feed : food.feed.toReversed();
    feed.append(composer('composer mt-sm', 'comment-text', 'Dodaj komentarz', 'Komentarz…', 'composer-btn',
      values => apply('food-comment', values, 'Dodano komentarz.', 'food-feed')), node('div', 'feed-list mt', ...entries.map(entry => {
      const copy = eventCopy[entry.kind];
      const article = node('article', 'feed-entry ' + (copy ? 'feed-event-row' : 'feed-comment'));
      article.id = 'food-entry-' + entry.id;
      const replies = entry.replies.length ? node('div', 'feed-replies',
        ...entry.replies.map(reply => {
          const header = head(reply);
          return mark(node('div', 'feed-reply', header, node('p', 'multiline', reply.text)), reply.id, header.firstElementChild);
        })) : null;
      const replyBox = node('details', 'reply-box', node('summary', 'reply-toggle', node('span', '', 'Odpowiedz')),
        composer('reply-form', 'reply-' + entry.id, 'Odpowiedź', 'Odpowiedź…', 'secondary composer-btn',
          values => apply('food-reply', { ...values, entry: entry.id }, 'Dodano odpowiedź.', article.id, { afterReplies: true }), true));
      if (copy) {
        const line = node('div', 'feed-event-line', node('p', 'feed-event', node('strong', '', entry.authorName || 'Organizator'),
          ' ' + copy[0] + ' ', node('strong', '', entry.itemTitle), copy[1]));
        article.append(line);
        if (replies) article.append(when(entry.createdAt), replies, replyBox);
        else article.append(node('div', 'feed-meta', when(entry.createdAt), replyBox));
        return mark(article, entry.id, line.firstElementChild);
      } else {
        const header = head(entry);
        article.append(header, node('p', 'multiline feed-body', entry.text), replies, replyBox);
        return mark(article, entry.id, header.firstElementChild);
      }
    })));
    return [node('h1', '', data.title), node('p', 'lead', 'Lista potraw na spotkanie. Każdy widzi, kto co przygotowuje.'), list, feed];
  }
  function render() {
    const view = { list, recipient: draw, food }[data.view];
    if (hint) hint.hidden = me().hints?.includes(hint.dataset.tabHint) ?? false;
    if (screen && view) screen.replaceChildren(...[hint, ...view()].filter(Boolean));
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
  const metadata = document.querySelector('meta[name="preview-data"]');
  if (metadata) startPreview(JSON.parse(metadata.content));
}
