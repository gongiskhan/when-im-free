/**
 * Calendar Blockify
 * Google Calendar integration via ICS feeds to display availability
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
  STORAGE_KEY_ICS_URL: 'calendar_blockify_ics_url',
};

// ==========================================
// State
// ==========================================
let state = {
  events: [],
  isLoaded: false,
};

// ==========================================
// DOM Elements
// ==========================================
const elements = {};

function cacheElements() {
  elements.btnLoad = document.getElementById('btnLoad');
  elements.btnDownload = document.getElementById('btnDownload');
  elements.btnCopy = document.getElementById('btnCopy');
  elements.icsUrlInput = document.getElementById('icsUrlInput');
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
  loadSavedSettings();
  initWeekPicker();
  initDefaultDates();
  wireEventListeners();
  updateStatus();
}

function loadSavedSettings() {
  const savedIcsUrl = localStorage.getItem(CONFIG.STORAGE_KEY_ICS_URL);
  if (savedIcsUrl) {
    elements.icsUrlInput.value = savedIcsUrl;
  }
}

function saveIcsUrl() {
  const icsUrl = elements.icsUrlInput.value.trim();
  if (icsUrl) {
    localStorage.setItem(CONFIG.STORAGE_KEY_ICS_URL, icsUrl);
  }
}

// ==========================================
// Event Listeners
// ==========================================
function wireEventListeners() {
  elements.btnLoad.addEventListener('click', handleLoadCalendar);
  elements.btnDownload.addEventListener('click', handleDownloadImage);
  elements.btnCopy.addEventListener('click', handleCopyToClipboard);

  // Auto-save ICS URL on blur
  elements.icsUrlInput.addEventListener('blur', saveIcsUrl);

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

  // Allow pressing Enter to load calendar
  elements.icsUrlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleLoadCalendar();
  });
}

// ==========================================
// Calendar Loading
// ==========================================
async function handleLoadCalendar() {
  const icsUrl = elements.icsUrlInput.value.trim();

  if (!icsUrl) {
    setStatus('Please enter your Google Calendar ICS URL', 'error');
    elements.icsUrlInput.focus();
    return;
  }

  saveIcsUrl();

  try {
    setStatus('Loading calendar...', 'loading');

    const icsData = await fetchICS(icsUrl);
    state.events = parseICS(icsData);
    state.isLoaded = true;

    const { start, end } = getSelectedRange();
    const busyByDay = buildBusyIntervalsByDay(state.events, start, end);

    renderCalendar(start, end, busyByDay);
    setLoaded(true);

    const endDisplay = new Date(end.getTime() - 86400000);
    setStatus(`Showing ${formatDateDisplay(start)} to ${formatDateDisplay(endDisplay)}`, 'success');
  } catch (error) {
    console.error('Load error:', error);
    setStatus(`Failed to load: ${error.message}`, 'error');
    setLoaded(false);
  }
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
  const icsUrl = elements.icsUrlInput.value.trim();

  if (!icsUrl) {
    setStatus('Enter your Google Calendar ICS URL to get started', 'info');
  } else {
    setStatus('Ready. Click "Load Calendar" to view availability.', 'info');
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
