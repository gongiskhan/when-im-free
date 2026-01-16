/**
 * Calendar Blockify
 * Google Calendar integration to display availability
 */

// ==========================================
// Configuration
// ==========================================
const CONFIG = {
  // Replace with your OAuth Client ID, or enter it in the UI
  CLIENT_ID: '',
  SCOPES: 'https://www.googleapis.com/auth/calendar.readonly',

  // Calendar display hours (24h format)
  DAY_START_HOUR: 9,
  DAY_END_HOUR: 21,

  // Pixels per hour for rendering
  PX_PER_HOUR: 56, // 3.5rem = 56px

  // Local storage key for persisting client ID
  STORAGE_KEY: 'calendar_blockify_client_id',
};

// ==========================================
// State
// ==========================================
let state = {
  tokenClient: null,
  accessToken: null,
  isConnected: false,
};

// ==========================================
// DOM Elements
// ==========================================
const elements = {};

function cacheElements() {
  elements.btnAuth = document.getElementById('btnAuth');
  elements.btnLoad = document.getElementById('btnLoad');
  elements.btnSaveClientId = document.getElementById('btnSaveClientId');
  elements.clientIdInput = document.getElementById('clientIdInput');
  elements.status = document.getElementById('status');
  elements.badge = document.getElementById('badge');
  elements.calendarId = document.getElementById('calendarId');
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
  loadSavedClientId();
  initWeekPicker();
  initDefaultDates();
  wireEventListeners();
  updateStatus();
}

function loadSavedClientId() {
  const saved = localStorage.getItem(CONFIG.STORAGE_KEY);
  if (saved) {
    CONFIG.CLIENT_ID = saved;
    elements.clientIdInput.value = saved;
  }
}

function saveClientId() {
  const value = elements.clientIdInput.value.trim();
  if (value) {
    CONFIG.CLIENT_ID = value;
    localStorage.setItem(CONFIG.STORAGE_KEY, value);
    setStatus('Client ID saved!', 'success');
    setTimeout(updateStatus, 2000);
  } else {
    setStatus('Please enter a valid Client ID', 'error');
  }
}

// ==========================================
// Event Listeners
// ==========================================
function wireEventListeners() {
  elements.btnAuth.addEventListener('click', handleAuth);
  elements.btnLoad.addEventListener('click', handleLoadCalendar);
  elements.btnSaveClientId.addEventListener('click', saveClientId);

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

  // Allow pressing Enter to save client ID
  elements.clientIdInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') saveClientId();
  });
}

// ==========================================
// Authentication
// ==========================================
function handleAuth() {
  if (!CONFIG.CLIENT_ID) {
    setStatus('Please enter your Google OAuth Client ID first', 'error');
    elements.clientIdInput.focus();
    return;
  }

  initTokenClient();
  state.tokenClient.requestAccessToken({ prompt: 'consent' });
}

function initTokenClient() {
  if (state.tokenClient) return;

  if (typeof google === 'undefined' || !google.accounts) {
    setStatus('Google Identity Services not loaded. Check your internet connection.', 'error');
    return;
  }

  state.tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: CONFIG.SCOPES,
    callback: handleAuthCallback,
  });
}

function handleAuthCallback(response) {
  if (response.error) {
    console.error('Auth error:', response);
    setStatus('Authentication failed. Please try again.', 'error');
    setConnected(false);
    return;
  }

  state.accessToken = response.access_token;
  setConnected(true);
  setStatus('Connected! Click "Load Calendar" to view availability.', 'success');
}

function setConnected(connected) {
  state.isConnected = connected;
  elements.badge.classList.toggle('hidden', !connected);
  elements.btnLoad.disabled = !connected;
}

// ==========================================
// Calendar Loading
// ==========================================
async function handleLoadCalendar() {
  if (!state.accessToken) {
    setStatus('Please connect your Google Calendar first', 'error');
    return;
  }

  try {
    setStatus('Loading calendar events...', 'loading');

    const { start, end } = getSelectedRange();
    const calendarId = elements.calendarId.value.trim() || 'primary';

    const events = await fetchEvents(calendarId, start, end);
    const busyByDay = buildBusyIntervalsByDay(events, start, end);

    renderCalendar(start, end, busyByDay);

    const endDisplay = new Date(end.getTime() - 86400000); // Subtract 1 day for display
    setStatus(`Showing ${formatDateDisplay(start)} to ${formatDateDisplay(endDisplay)}`, 'success');
  } catch (error) {
    console.error('Load error:', error);

    if (error.message.includes('401') || error.message.includes('403')) {
      setStatus('Session expired. Please reconnect your calendar.', 'error');
      setConnected(false);
    } else {
      setStatus('Failed to load calendar. Check console for details.', 'error');
    }
  }
}

// ==========================================
// Google Calendar API
// ==========================================
async function fetchEvents(calendarId, start, end) {
  if (!state.accessToken) {
    throw new Error('Not authenticated');
  }

  const timeMin = start.toISOString();
  const timeMax = end.toISOString();
  const allEvents = [];
  let pageToken = '';

  do {
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
    );

    url.searchParams.set('timeMin', timeMin);
    url.searchParams.set('timeMax', timeMax);
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    url.searchParams.set('maxResults', '2500');

    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${state.accessToken}` },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Calendar API error ${response.status}: ${text}`);
    }

    const data = await response.json();

    if (Array.isArray(data.items)) {
      allEvents.push(...data.items);
    }

    pageToken = data.nextPageToken || '';
  } while (pageToken);

  return allEvents;
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
  if (event?.start?.dateTime && event?.end?.dateTime) {
    return {
      start: new Date(event.start.dateTime),
      end: new Date(event.end.dateTime),
    };
  }

  // All-day events
  if (event?.start?.date && event?.end?.date) {
    return {
      start: parseDate(event.start.date),
      end: parseDate(event.end.date),
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

  const columnCount = days.length + 1; // +1 for time column
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
      const endStr = formatDateDisplay(new Date(week.end.getTime() - 86400000)); // -1 day for display
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
    const start = parseDate(elements.rangeStart.value);
    const endInclusive = parseDate(elements.rangeEnd.value);

    if (!start || !endInclusive) {
      throw new Error('Invalid date range');
    }

    // Make end exclusive by adding 1 day
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
  const diff = day === 0 ? -6 : 1 - day; // Monday start
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

function parseDate(str) {
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

  // Reset classes
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
  if (!CONFIG.CLIENT_ID) {
    setStatus('Enter your Google OAuth Client ID to get started', 'info');
  } else if (!state.isConnected) {
    setStatus('Ready. Click "Connect Google Calendar" to begin.', 'info');
  } else {
    setStatus('Connected. Select a week or date range and click "Load Calendar".', 'success');
  }
}
