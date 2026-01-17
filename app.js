/**
 * Calendar Blockify
 * Google Calendar integration via ICS feeds to display availability
 * Supports multiple calendars with visibility toggles
 */

// ==========================================
// Configuration
// ==========================================
const CONFIG = {
  // Cloudflare Worker proxy URL
  PROXY_URL: 'https://calendar-blockify-proxy.goncalo-p-gomes.workers.dev',

  // Calendar display hours (24h format)
  DAY_START_HOUR: 9,
  DAY_END_HOUR: 21,

  // Pixels per hour for rendering
  PX_PER_HOUR: 56, // 3.5rem = 56px

  // Local storage key
  STORAGE_KEY_CALENDARS: 'calendar_blockify_calendars',
};

// ==========================================
// State
// ==========================================
let state = {
  calendars: [], // Array of { id, name, url, visible, events, color }
  isLoaded: false,
};

// Calendar colors for visual distinction
const CALENDAR_COLORS = [
  { bg: 'from-rose-500/80 to-pink-500/80', border: 'border-rose-400/30' },
  { bg: 'from-violet-500/80 to-purple-500/80', border: 'border-violet-400/30' },
  { bg: 'from-blue-500/80 to-cyan-500/80', border: 'border-blue-400/30' },
  { bg: 'from-emerald-500/80 to-teal-500/80', border: 'border-emerald-400/30' },
  { bg: 'from-amber-500/80 to-orange-500/80', border: 'border-amber-400/30' },
  { bg: 'from-fuchsia-500/80 to-pink-500/80', border: 'border-fuchsia-400/30' },
];

// ==========================================
// DOM Elements
// ==========================================
const elements = {};

function cacheElements() {
  elements.btnLoad = document.getElementById('btnLoad');
  elements.btnDownload = document.getElementById('btnDownload');
  elements.btnCopy = document.getElementById('btnCopy');
  elements.btnAddCalendar = document.getElementById('btnAddCalendar');
  elements.icsUrlInput = document.getElementById('icsUrlInput');
  elements.calendarNameInput = document.getElementById('calendarNameInput');
  elements.calendarList = document.getElementById('calendarList');
  elements.status = document.getElementById('status');
  elements.badge = document.getElementById('badge');
  elements.weekSelect = document.getElementById('weekSelect');
  elements.rangeStart = document.getElementById('rangeStart');
  elements.rangeEnd = document.getElementById('rangeEnd');
  elements.useWeek = document.getElementById('useWeek');
  elements.useRange = document.getElementById('useRange');
  elements.calendarWrap = document.getElementById('calendarWrap');
}

// ==========================================
// Initialization
// ==========================================
document.addEventListener('DOMContentLoaded', init);

function init() {
  cacheElements();
  loadSavedCalendars();
  renderCalendarList();
  initWeekPicker();
  initDefaultDates();
  wireEventListeners();
  updateStatus();
}

function loadSavedCalendars() {
  try {
    const saved = localStorage.getItem(CONFIG.STORAGE_KEY_CALENDARS);
    if (saved) {
      state.calendars = JSON.parse(saved);
      // Clear events on load (will be fetched fresh)
      state.calendars.forEach(cal => cal.events = []);
    }
  } catch (e) {
    console.error('Failed to load saved calendars:', e);
    state.calendars = [];
  }
}

function saveCalendars() {
  // Save without events (they'll be fetched fresh)
  const toSave = state.calendars.map(({ id, name, url, visible, color }) => ({
    id, name, url, visible, color
  }));
  localStorage.setItem(CONFIG.STORAGE_KEY_CALENDARS, JSON.stringify(toSave));
}

// ==========================================
// Calendar Management
// ==========================================
function addCalendar(name, url) {
  const id = Date.now().toString(36) + Math.random().toString(36).substr(2);
  const colorIndex = state.calendars.length % CALENDAR_COLORS.length;

  const calendar = {
    id,
    name: name || extractCalendarName(url),
    url,
    visible: true,
    events: [],
    color: colorIndex,
  };

  state.calendars.push(calendar);
  saveCalendars();
  renderCalendarList();
  return calendar;
}

function removeCalendar(id) {
  state.calendars = state.calendars.filter(cal => cal.id !== id);
  saveCalendars();
  renderCalendarList();

  // Re-render if we have loaded data
  if (state.isLoaded) {
    refreshCalendarDisplay();
  }
}

function toggleCalendarVisibility(id) {
  const cal = state.calendars.find(c => c.id === id);
  if (cal) {
    cal.visible = !cal.visible;
    saveCalendars();
    renderCalendarList();

    // Re-render if we have loaded data
    if (state.isLoaded) {
      refreshCalendarDisplay();
    }
  }
}

function extractCalendarName(url) {
  // Try to extract email from Google Calendar URL
  const match = url.match(/calendar\/ical\/([^/]+)/);
  if (match) {
    const decoded = decodeURIComponent(match[1]);
    // If it looks like an email, use the part before @
    if (decoded.includes('@')) {
      return decoded.split('@')[0];
    }
    return decoded;
  }
  return 'Calendar ' + (state.calendars.length + 1);
}

// ==========================================
// Event Listeners
// ==========================================
function wireEventListeners() {
  elements.btnLoad.addEventListener('click', handleLoadCalendars);
  elements.btnDownload.addEventListener('click', handleDownloadImage);
  elements.btnCopy.addEventListener('click', handleCopyToClipboard);
  elements.btnAddCalendar.addEventListener('click', handleAddCalendar);

  // Auto-switch mode based on input
  elements.weekSelect.addEventListener('change', () => {
    elements.useWeek.checked = true;
  });

  elements.rangeStart.addEventListener('change', () => {
    elements.useRange.checked = true;
  });

  elements.rangeEnd.addEventListener('change', () => {
    elements.useRange.checked = true;
  });

  // Allow pressing Enter to add calendar
  elements.icsUrlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleAddCalendar();
  });

  elements.calendarNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleAddCalendar();
  });
}

function handleAddCalendar() {
  const url = elements.icsUrlInput.value.trim();
  const name = elements.calendarNameInput.value.trim();

  if (!url) {
    setStatus('Please enter a Google Calendar ICS URL', 'error');
    elements.icsUrlInput.focus();
    return;
  }

  // Check for duplicate URL
  if (state.calendars.some(cal => cal.url === url)) {
    setStatus('This calendar has already been added', 'error');
    return;
  }

  addCalendar(name, url);

  // Clear inputs
  elements.icsUrlInput.value = '';
  elements.calendarNameInput.value = '';

  setStatus('Calendar added. Click "Load Calendars" to fetch data.', 'success');
}

// ==========================================
// Calendar List Rendering
// ==========================================
function renderCalendarList() {
  if (state.calendars.length === 0) {
    elements.calendarList.innerHTML = `
      <div class="text-center py-4 text-slate-500 text-sm">
        No calendars added yet. Add your first calendar above.
      </div>
    `;
    return;
  }

  elements.calendarList.innerHTML = state.calendars.map(cal => {
    const colorClass = CALENDAR_COLORS[cal.color];
    return `
      <div class="flex items-center gap-3 p-3 rounded-lg bg-slate-800/30 border border-white/5 group">
        <button
          onclick="toggleCalendarVisibility('${cal.id}')"
          class="flex-shrink-0 w-5 h-5 rounded border-2 ${cal.visible ? 'bg-gradient-to-r ' + colorClass.bg + ' border-transparent' : 'border-slate-500 bg-transparent'} transition-all hover:scale-110"
          title="${cal.visible ? 'Hide calendar' : 'Show calendar'}"
        >
          ${cal.visible ? `<svg class="w-full h-full text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
          </svg>` : ''}
        </button>
        <div class="flex-1 min-w-0">
          <div class="font-medium text-sm text-white truncate">${escapeHtml(cal.name)}</div>
          <div class="text-xs text-slate-500 truncate">${escapeHtml(cal.url.substring(0, 50))}...</div>
        </div>
        <button
          onclick="removeCalendar('${cal.id}')"
          class="flex-shrink-0 p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded transition-colors opacity-0 group-hover:opacity-100"
          title="Remove calendar"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    `;
  }).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ==========================================
// Calendar Loading
// ==========================================
async function handleLoadCalendars() {
  if (state.calendars.length === 0) {
    setStatus('Please add at least one calendar first', 'error');
    return;
  }

  try {
    setStatus('Loading calendars...', 'loading');

    // Fetch all calendars in parallel
    const results = await Promise.allSettled(
      state.calendars.map(async (cal) => {
        const icsData = await fetchICS(cal.url);
        cal.events = parseICS(icsData);
        return cal;
      })
    );

    // Count successes and failures
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    if (successful === 0) {
      throw new Error('Failed to load any calendars');
    }

    state.isLoaded = true;
    refreshCalendarDisplay();
    setLoaded(true);

    if (failed > 0) {
      setStatus(`Loaded ${successful} calendar(s), ${failed} failed`, 'success');
    } else {
      const { start, end } = getSelectedRange();
      const endDisplay = new Date(end.getTime() - 86400000);
      setStatus(`Showing ${formatDateDisplay(start)} to ${formatDateDisplay(endDisplay)}`, 'success');
    }
  } catch (error) {
    console.error('Load error:', error);
    setStatus(`Failed to load: ${error.message}`, 'error');
    setLoaded(false);
  }
}

function refreshCalendarDisplay() {
  const { start, end } = getSelectedRange();

  // Collect events from all visible calendars
  const allEvents = state.calendars
    .filter(cal => cal.visible)
    .flatMap(cal => cal.events);

  const busyByDay = buildBusyIntervalsByDay(allEvents, start, end);
  renderCalendar(start, end, busyByDay);
}

function setLoaded(loaded) {
  state.isLoaded = loaded;
  elements.badge.classList.toggle('hidden', !loaded);
  elements.btnDownload.classList.toggle('hidden', !loaded);
  elements.btnCopy.classList.toggle('hidden', !loaded);
}

// ==========================================
// ICS Fetching & Parsing
// ==========================================
async function fetchICS(icsUrl) {
  const proxyUrl = `${CONFIG.PROXY_URL}?url=${encodeURIComponent(icsUrl)}`;

  const response = await fetch(proxyUrl);

  if (!response.ok) {
    const text = await response.text();
    let errorMsg = `HTTP ${response.status}`;
    try {
      const json = JSON.parse(text);
      if (json.error) errorMsg = json.error;
    } catch {}
    throw new Error(errorMsg);
  }

  return response.text();
}

function parseICS(icsData) {
  const events = [];
  const lines = icsData.split(/\r?\n/);

  let currentEvent = null;
  let currentKey = '';
  let currentValue = '';

  for (const line of lines) {
    // Handle line continuations (lines starting with space or tab)
    if (line.startsWith(' ') || line.startsWith('\t')) {
      currentValue += line.slice(1);
      continue;
    }

    // Process previous key-value if we have one
    if (currentKey && currentEvent) {
      processICSProperty(currentEvent, currentKey, currentValue);
    }

    // Parse new key-value
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) {
      currentKey = '';
      currentValue = '';
      continue;
    }

    currentKey = line.slice(0, colonIndex);
    currentValue = line.slice(colonIndex + 1);

    // Handle BEGIN/END
    if (currentKey === 'BEGIN' && currentValue === 'VEVENT') {
      currentEvent = {};
      currentKey = '';
    } else if (currentKey === 'END' && currentValue === 'VEVENT') {
      if (currentEvent && (currentEvent.start || currentEvent.startDate)) {
        events.push(currentEvent);
      }
      currentEvent = null;
      currentKey = '';
    }
  }

  return events;
}

function processICSProperty(event, key, value) {
  // Handle parameters in key (e.g., DTSTART;TZID=America/New_York)
  const [baseKey, ...params] = key.split(';');

  switch (baseKey) {
    case 'DTSTART':
      if (key.includes('VALUE=DATE')) {
        // All-day event start
        event.startDate = parseICSDate(value);
        event.allDay = true;
      } else {
        event.start = parseICSDateTime(value);
      }
      break;

    case 'DTEND':
      if (key.includes('VALUE=DATE')) {
        // All-day event end
        event.endDate = parseICSDate(value);
      } else {
        event.end = parseICSDateTime(value);
      }
      break;

    case 'SUMMARY':
      event.summary = unescapeICS(value);
      break;

    case 'RRULE':
      // We don't expand recurring events - Google's ICS feed gives us instances
      event.rrule = value;
      break;
  }
}

function parseICSDateTime(value) {
  // Format: 20240115T140000Z or 20240115T140000
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!match) return null;

  const [, year, month, day, hour, minute, second, isUTC] = match;

  if (isUTC) {
    return new Date(Date.UTC(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hour),
      parseInt(minute),
      parseInt(second)
    ));
  } else {
    return new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hour),
      parseInt(minute),
      parseInt(second)
    );
  }
}

function parseICSDate(value) {
  // Format: 20240115
  const match = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return null;

  const [, year, month, day] = match;
  return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
}

function unescapeICS(value) {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

// ==========================================
// Event Processing
// ==========================================
function buildBusyIntervalsByDay(events, rangeStart, rangeEnd) {
  const busyMap = new Map();

  for (const event of events) {
    const times = getEventTimes(event);
    if (!times) continue;

    const segments = sliceEventIntoDays(times.start, times.end, rangeStart, rangeEnd);

    for (const segment of segments) {
      if (!busyMap.has(segment.dayKey)) {
        busyMap.set(segment.dayKey, []);
      }
      busyMap.get(segment.dayKey).push({
        start: segment.start,
        end: segment.end,
      });
    }
  }

  // Merge overlapping intervals for each day
  for (const [dayKey, intervals] of busyMap.entries()) {
    busyMap.set(dayKey, mergeIntervals(intervals));
  }

  return busyMap;
}

function getEventTimes(event) {
  // Timed events
  if (event.start && event.end) {
    return {
      start: event.start,
      end: event.end,
    };
  }

  // All-day events
  if (event.startDate && event.endDate) {
    return {
      start: event.startDate,
      end: event.endDate,
    };
  }

  // Single all-day event (no end date means next day)
  if (event.startDate) {
    const end = new Date(event.startDate);
    end.setDate(end.getDate() + 1);
    return {
      start: event.startDate,
      end: end,
    };
  }

  return null;
}

function sliceEventIntoDays(start, end, rangeStart, rangeEnd) {
  // Clamp to selected range
  const clampedStart = new Date(Math.max(start.getTime(), rangeStart.getTime()));
  const clampedEnd = new Date(Math.min(end.getTime(), rangeEnd.getTime()));

  if (clampedEnd <= clampedStart) return [];

  const segments = [];
  const cursor = new Date(clampedStart);
  cursor.setHours(0, 0, 0, 0);

  while (cursor < clampedEnd) {
    const dayStart = new Date(cursor);
    const dayEnd = new Date(cursor);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const segmentStart = new Date(Math.max(clampedStart.getTime(), dayStart.getTime()));
    const segmentEnd = new Date(Math.min(clampedEnd.getTime(), dayEnd.getTime()));

    segments.push({
      dayKey: formatDate(dayStart),
      start: segmentStart,
      end: segmentEnd,
    });

    cursor.setDate(cursor.getDate() + 1);
  }

  return segments;
}

function mergeIntervals(intervals) {
  if (!intervals.length) return [];

  const sorted = intervals
    .map((i) => ({ start: new Date(i.start), end: new Date(i.end) }))
    .sort((a, b) => a.start - b.start);

  const merged = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const current = sorted[i];

    if (current.start <= last.end) {
      last.end = new Date(Math.max(last.end.getTime(), current.end.getTime()));
    } else {
      merged.push(current);
    }
  }

  return merged;
}

// ==========================================
// Calendar Rendering
// ==========================================
function renderCalendar(rangeStart, rangeEnd, busyByDay) {
  const days = getDaysInRange(rangeStart, rangeEnd);
  const hours = getHoursArray();
  const totalHeight = (CONFIG.DAY_END_HOUR - CONFIG.DAY_START_HOUR) * CONFIG.PX_PER_HOUR;
  const today = formatDate(new Date());

  const columnWidth = days.length <= 7 ? 'minmax(140px, 1fr)' : 'minmax(120px, 1fr)';

  let html = `
    <div class="calendar-grid" style="grid-template-columns: 70px repeat(${days.length}, ${columnWidth});">
      <!-- Header Row -->
      <div class="calendar-header" style="display: contents;">
        <div class="calendar-header-cell calendar-time-column">
          <span class="text-xs text-slate-500 font-medium">TIME</span>
        </div>
        ${days
          .map((day) => {
            const dayKey = formatDate(day);
            const isToday = dayKey === today;
            const dayName = day.toLocaleDateString('en-US', { weekday: 'short' });
            const dayDate = day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

            return `
            <div class="calendar-header-cell ${isToday ? 'today-column' : ''}">
              <div class="${isToday ? 'today-header' : ''}">
                <div class="calendar-day-name ${isToday ? 'text-violet-300' : ''}">${dayName}</div>
                <div class="calendar-day-date ${isToday ? 'text-violet-400' : ''}">${dayDate}</div>
              </div>
            </div>
          `;
          })
          .join('')}
      </div>

      <!-- Time Column -->
      <div class="calendar-time-column">
        ${hours
          .slice(0, -1)
          .map(
            (h) => `
          <div class="calendar-time-cell">
            ${String(h).padStart(2, '0')}:00
          </div>
        `
          )
          .join('')}
      </div>

      <!-- Day Columns -->
      ${days
        .map((day) => {
          const dayKey = formatDate(day);
          const isToday = dayKey === today;
          const intervals = busyByDay.get(dayKey) || [];

          const blocks = intervals
            .map((interval) => clampToWorkingHours(interval.start, interval.end, day))
            .filter(Boolean)
            .map(({ startMin, endMin }) => {
              const top = (startMin / 60) * CONFIG.PX_PER_HOUR;
              const height = Math.max(((endMin - startMin) / 60) * CONFIG.PX_PER_HOUR, 24);
              const isSmall = height < 32;

              return `
              <div
                class="busy-block ${isSmall ? 'busy-block-small' : ''}"
                style="top: ${top}px; height: ${height}px;"
                title="Unavailable"
              >
                ${height >= 24 ? 'Unavailable' : ''}
              </div>
            `;
            })
            .join('');

          return `
          <div class="calendar-day-column ${isToday ? 'today-column' : ''}" style="height: ${totalHeight}px;">
            <!-- Hour grid lines -->
            ${hours
              .slice(0, -1)
              .map(() => `<div class="calendar-hour-row"></div>`)
              .join('')}

            <!-- Busy blocks -->
            ${blocks}
          </div>
        `;
        })
        .join('')}
    </div>
  `;

  elements.calendarWrap.innerHTML = html;
}

function clampToWorkingHours(start, end, dayDate) {
  const dayStart = new Date(dayDate);
  dayStart.setHours(CONFIG.DAY_START_HOUR, 0, 0, 0);

  const dayEnd = new Date(dayDate);
  dayEnd.setHours(CONFIG.DAY_END_HOUR, 0, 0, 0);

  const clampedStart = new Date(Math.max(start.getTime(), dayStart.getTime()));
  const clampedEnd = new Date(Math.min(end.getTime(), dayEnd.getTime()));

  if (clampedEnd <= clampedStart) return null;

  const startMin = (clampedStart.getHours() - CONFIG.DAY_START_HOUR) * 60 + clampedStart.getMinutes();
  const endMin = (clampedEnd.getHours() - CONFIG.DAY_START_HOUR) * 60 + clampedEnd.getMinutes();

  return { startMin, endMin };
}

// ==========================================
// Date/Time Utilities
// ==========================================
function initWeekPicker() {
  const now = new Date();
  const year = now.getFullYear();
  const endOfYear = new Date(year, 11, 31, 23, 59, 59, 999);

  const firstMonday = getStartOfWeek(now);
  const weeks = [];
  const cursor = new Date(firstMonday);

  while (cursor <= endOfYear) {
    const start = new Date(cursor);
    const end = new Date(cursor);
    end.setDate(end.getDate() + 7);

    weeks.push({ start, end });
    cursor.setDate(cursor.getDate() + 7);
  }

  elements.weekSelect.innerHTML = weeks
    .map((week, index) => {
      const startStr = formatDateDisplay(week.start);
      const endStr = formatDateDisplay(new Date(week.end.getTime() - 86400000));
      return `<option value="${index}">${startStr} - ${endStr}</option>`;
    })
    .join('');

  elements.weekSelect.value = '0';
}

function initDefaultDates() {
  const today = new Date();
  elements.rangeStart.value = formatDateInput(today);

  const nextWeek = new Date(today);
  nextWeek.setDate(nextWeek.getDate() + 7);
  elements.rangeEnd.value = formatDateInput(nextWeek);
}

function getSelectedRange() {
  if (elements.useRange.checked) {
    const start = parseDateString(elements.rangeStart.value);
    const endInclusive = parseDateString(elements.rangeEnd.value);

    if (!start || !endInclusive) {
      throw new Error('Invalid date range');
    }

    const end = new Date(endInclusive);
    end.setDate(end.getDate() + 1);

    return normalizeRange(start, end);
  }

  // Week mode
  const weekIndex = parseInt(elements.weekSelect.value, 10) || 0;
  const now = new Date();
  const firstMonday = getStartOfWeek(now);

  const start = new Date(firstMonday);
  start.setDate(start.getDate() + weekIndex * 7);

  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  return normalizeRange(start, end);
}

function normalizeRange(start, end) {
  const s = new Date(start);
  s.setHours(0, 0, 0, 0);

  const e = new Date(end);
  e.setHours(0, 0, 0, 0);

  return { start: s, end: e };
}

function getStartOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);

  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);

  return d;
}

function getDaysInRange(start, end) {
  const days = [];
  const cursor = new Date(start);

  while (cursor < end) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

function getHoursArray() {
  const hours = [];
  for (let h = CONFIG.DAY_START_HOUR; h <= CONFIG.DAY_END_HOUR; h++) {
    hours.push(h);
  }
  return hours;
}

function parseDateString(str) {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDateInput(date) {
  return formatDate(date);
}

function formatDateDisplay(date) {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ==========================================
// Status Updates
// ==========================================
function setStatus(message, type = 'info') {
  elements.status.textContent = message;

  elements.status.className = 'text-sm transition-colors duration-200';

  switch (type) {
    case 'success':
      elements.status.classList.add('text-emerald-400');
      break;
    case 'error':
      elements.status.classList.add('text-rose-400');
      break;
    case 'loading':
      elements.status.classList.add('text-violet-400');
      break;
    default:
      elements.status.classList.add('text-slate-400');
  }
}

function updateStatus() {
  if (state.calendars.length === 0) {
    setStatus('Add your Google Calendar ICS URLs to get started', 'info');
  } else {
    setStatus(`${state.calendars.length} calendar(s) added. Click "Load Calendars" to view.`, 'info');
  }
}

// ==========================================
// Image Export
// ==========================================
async function captureCalendarImage() {
  const calendarSection = elements.calendarWrap.closest('section');

  // Temporarily add padding and background for better screenshot
  const originalPadding = calendarSection.style.padding;
  calendarSection.style.padding = '20px';

  try {
    const canvas = await html2canvas(calendarSection, {
      backgroundColor: '#0f172a', // slate-900
      scale: 2, // Higher resolution
      logging: false,
      useCORS: true,
    });

    calendarSection.style.padding = originalPadding;
    return canvas;
  } catch (error) {
    calendarSection.style.padding = originalPadding;
    throw error;
  }
}

async function handleDownloadImage() {
  try {
    setStatus('Generating image...', 'loading');
    elements.btnDownload.disabled = true;

    const canvas = await captureCalendarImage();

    // Generate filename with date range
    const { start, end } = getSelectedRange();
    const endDisplay = new Date(end.getTime() - 86400000);
    const startStr = formatDate(start);
    const endStr = formatDate(endDisplay);
    const filename = `availability-${startStr}-to-${endStr}.png`;

    // Download
    const link = document.createElement('a');
    link.download = filename;
    link.href = canvas.toDataURL('image/png');
    link.click();

    setStatus('Image downloaded', 'success');
  } catch (error) {
    console.error('Download error:', error);
    setStatus('Failed to generate image', 'error');
  } finally {
    elements.btnDownload.disabled = false;
  }
}

async function handleCopyToClipboard() {
  try {
    setStatus('Copying to clipboard...', 'loading');
    elements.btnCopy.disabled = true;

    const canvas = await captureCalendarImage();

    // Convert canvas to blob
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to create blob'));
      }, 'image/png');
    });

    // Copy to clipboard
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': blob }),
    ]);

    setStatus('Copied to clipboard', 'success');
  } catch (error) {
    console.error('Copy error:', error);
    // Fallback message if clipboard API fails
    if (error.name === 'NotAllowedError') {
      setStatus('Clipboard access denied. Try downloading instead.', 'error');
    } else {
      setStatus('Failed to copy to clipboard', 'error');
    }
  } finally {
    elements.btnCopy.disabled = false;
  }
}

// Make functions available globally for onclick handlers
window.toggleCalendarVisibility = toggleCalendarVisibility;
window.removeCalendar = removeCalendar;
