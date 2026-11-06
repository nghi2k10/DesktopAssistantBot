import { toast } from '../../components/toast.js';
import {
  buildMonthlyCalendar,
  CalendarDayDetails,
  convertLunar2Solar,
  convertSolar2Lunar,
  getAuspiciousInfo,
  getCanChiInfo,
  getDayDetails,
  getVietnamToday
} from '../../utils/lunar-calendar.js';

export interface CalendarPageCallbacks {
  onCreateLunarReminderForDate: (lunarDay: number, lunarMonth: number) => void;
}

const MONTH_NAMES = [
  'Tháng 1 (January)',
  'Tháng 2 (February)',
  'Tháng 3 (March)',
  'Tháng 4 (April)',
  'Tháng 5 (May)',
  'Tháng 6 (June)',
  'Tháng 7 (July)',
  'Tháng 8 (August)',
  'Tháng 9 (September)',
  'Tháng 10 (October)',
  'Tháng 11 (November)',
  'Tháng 12 (December)'
];

export class CalendarPage {
  private readonly container: HTMLElement;
  private readonly callbacks: CalendarPageCallbacks;

  private viewYear: number;
  private viewMonth: number;
  private selectedDay: CalendarDayDetails;

  // Converter state
  private convSolarResultText = '';
  private convLunarResultText = '';

  constructor(container: HTMLElement, callbacks: CalendarPageCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    const today = getVietnamToday();
    this.viewYear = today.year;
    this.viewMonth = today.month;
    this.selectedDay = getDayDetails(today.day, today.month, today.year, true, today.isoDate);
  }

  public render(): void {
    const cells = buildMonthlyCalendar(this.viewYear, this.viewMonth);
    const sel = this.selectedDay;

    this.container.innerHTML = `
      <div class="module-page calendar-page">
        <div class="calendar-layout">
          <!-- Left: Monthly Solar / Lunar Calendar Grid -->
          <section class="card calendar-main-card">
            <div class="calendar-header">
              <div class="calendar-nav-title">
                <h3 id="calendar-month-title">${this.escapeHtml(
                  MONTH_NAMES[this.viewMonth - 1]
                )} — ${this.viewYear}</h3>
                <span class="badge badge-neutral">UTC+7 • Hồ Ngọc Đức Algorithm</span>
              </div>

              <div class="calendar-nav-buttons">
                <button type="button" id="cal-prev-month" class="btn btn-secondary btn-sm">
                  &larr; Prev
                </button>
                <button type="button" id="cal-today-btn" class="btn btn-primary btn-sm">
                  Today
                </button>
                <button type="button" id="cal-next-month" class="btn btn-secondary btn-sm">
                  Next &rarr;
                </button>
              </div>
            </div>

            <div class="calendar-weekdays">
              <span>Mon (T2)</span>
              <span>Tue (T3)</span>
              <span>Wed (T4)</span>
              <span>Thu (T5)</span>
              <span>Fri (T6)</span>
              <span>Sat (T7)</span>
              <span class="text-danger">Sun (CN)</span>
            </div>

            <div class="calendar-grid">
              ${cells.map((cell) => this.renderDayCell(cell)).join('')}
            </div>
          </section>

          <!-- Right: Selected Day Inspector & Can Chi / Auspicious Details -->
          <aside class="card calendar-inspector-card">
            <div class="inspector-top">
              <span class="badge ${
                sel.auspicious.status === 'Hoàng Đạo' ? 'badge-offline' : 'badge-neutral'
              }">
                Ngày ${this.escapeHtml(sel.auspicious.status)} • ${this.escapeHtml(
      sel.auspicious.starName
    )}
              </span>

              <div class="inspector-dates-row">
                <div class="inspector-date-block">
                  <span class="inspector-date-label">Solar Date (Dương lịch)</span>
                  <strong id="cal-selected-solar" class="inspector-big-num">${sel.solarDay}/${
      sel.solarMonth
    }/${sel.solarYear}</strong>
                </div>

                <div class="inspector-date-block">
                  <span class="inspector-date-label">Lunar Date (Âm lịch)</span>
                  <strong id="cal-selected-lunar" class="inspector-big-num text-emerald">
                    ${sel.lunar.day}/${sel.lunar.month}/${sel.lunar.year}${
      sel.lunar.isLeapMonth ? ' (Nhuận)' : ''
    }
                  </strong>
                </div>
              </div>

              ${
                sel.holidayOrSolarTerm
                  ? `<div class="holiday-banner">${this.escapeHtml(
                      sel.holidayOrSolarTerm
                    )}</div>`
                  : ''
              }
            </div>

            <div class="canchi-panel">
              <h4 class="subtable-title">Can Chi (Sexagenary Cycle)</h4>
              <div class="canchi-row">
                <span>Day (Ngày):</span>
                <strong id="cal-canchi-day">${this.escapeHtml(sel.canChi.dayCanChi)}</strong>
              </div>
              <div class="canchi-row">
                <span>Month (Tháng):</span>
                <strong id="cal-canchi-month">${this.escapeHtml(sel.canChi.monthCanChi)}</strong>
              </div>
              <div class="canchi-row">
                <span>Year (Năm):</span>
                <strong id="cal-canchi-year">${this.escapeHtml(sel.canChi.yearCanChi)}</strong>
              </div>
            </div>

            <div class="auspicious-panel">
              <h4 class="subtable-title">Traditional Auspicious Hours (Giờ Hoàng Đạo)</h4>
              <p class="rule-note">${this.escapeHtml(sel.auspicious.ruleExplanation)}</p>
              <div class="hours-pill-grid">
                ${sel.auspicious.auspiciousHours
                  .map((h) => `<span class="hour-pill">${this.escapeHtml(h)}</span>`)
                  .join('')}
              </div>
            </div>

            <button type="button" id="cal-create-lunar-rem-btn" class="btn btn-primary btn-full">
              + Create Lunar Reminder (${sel.lunar.day}/${sel.lunar.month} Âm lịch)
            </button>
          </aside>
        </div>

        <!-- Bidirectional Date Converter Section -->
        <section class="card converter-section-card">
          <div class="section-header">
            <div>
              <h3 class="section-title">Solar &harr; Vietnamese Lunar Date Converter</h3>
              <p class="section-desc">Convert between Solar (Dương lịch) and Lunar (Âm lịch) dates including leap months (Tháng Nhuận)</p>
            </div>
          </div>

          <div class="converter-grid">
            <!-- Solar to Lunar -->
            <div class="converter-box">
              <h4>Convert Solar &rarr; Lunar</h4>
              <div class="form-row-3">
                <div class="form-field">
                  <label for="conv-s2l-day" class="input-label">Solar Day</label>
                  <input type="number" id="conv-s2l-day" class="input-text" min="1" max="31" value="${
                    sel.solarDay
                  }" />
                </div>
                <div class="form-field">
                  <label for="conv-s2l-month" class="input-label">Solar Month</label>
                  <input type="number" id="conv-s2l-month" class="input-text" min="1" max="12" value="${
                    sel.solarMonth
                  }" />
                </div>
                <div class="form-field">
                  <label for="conv-s2l-year" class="input-label">Solar Year</label>
                  <input type="number" id="conv-s2l-year" class="input-text" min="1900" max="2199" value="${
                    sel.solarYear
                  }" />
                </div>
              </div>
              <button type="button" id="conv-s2l-btn" class="btn btn-secondary btn-sm">
                Convert to Lunar Date
              </button>
              <div id="conv-s2l-result" class="converter-result-box">
                ${
                  this.convSolarResultText ||
                  `Lunar: ${sel.lunar.day}/${sel.lunar.month}/${sel.lunar.year}${
                    sel.lunar.isLeapMonth ? ' (Tháng Nhuận)' : ''
                  } • Năm ${sel.canChi.yearCanChi}, Tháng ${sel.canChi.monthCanChi}, Ngày ${
                    sel.canChi.dayCanChi
                  }`
                }
              </div>
            </div>

            <!-- Lunar to Solar -->
            <div class="converter-box">
              <h4>Convert Lunar &rarr; Solar</h4>
              <div class="form-row-3">
                <div class="form-field">
                  <label for="conv-l2s-day" class="input-label">Lunar Day</label>
                  <input type="number" id="conv-l2s-day" class="input-text" min="1" max="30" value="${
                    sel.lunar.day
                  }" />
                </div>
                <div class="form-field">
                  <label for="conv-l2s-month" class="input-label">Lunar Month</label>
                  <input type="number" id="conv-l2s-month" class="input-text" min="1" max="12" value="${
                    sel.lunar.month
                  }" />
                </div>
                <div class="form-field">
                  <label for="conv-l2s-year" class="input-label">Lunar Year</label>
                  <input type="number" id="conv-l2s-year" class="input-text" min="1900" max="2199" value="${
                    sel.lunar.year
                  }" />
                </div>
              </div>
              <div class="converter-action-row">
                <label class="checkbox-inline">
                  <input type="checkbox" id="conv-l2s-leap" ${
                    sel.lunar.isLeapMonth ? 'checked' : ''
                  } />
                  <span>Leap Lunar Month (Tháng Nhuận)</span>
                </label>
                <button type="button" id="conv-l2s-btn" class="btn btn-secondary btn-sm">
                  Convert to Solar Date
                </button>
              </div>
              <div id="conv-l2s-result" class="converter-result-box">
                ${
                  this.convLunarResultText ||
                  `Solar: ${sel.solarDay}/${sel.solarMonth}/${sel.solarYear}`
                }
              </div>
            </div>
          </div>
        </section>
      </div>
    `;

    this.bindEvents();
  }

  private renderDayCell(cell: CalendarDayDetails): string {
    const isSelected = cell.isoDate === this.selectedDay.isoDate;
    const isFirstOrFull = cell.lunar.day === 1 || cell.lunar.day === 15;
    const lunarLabel =
      cell.lunar.day === 1 || cell.solarDay === 1
        ? `${cell.lunar.day}/${cell.lunar.month}${cell.lunar.isLeapMonth ? 'N' : ''}`
        : String(cell.lunar.day);

    return `
      <button
        type="button"
        class="cal-cell ${cell.isCurrentMonth ? '' : 'cal-cell-muted'} ${
          cell.isToday ? 'cal-cell-today' : ''
        } ${isSelected ? 'cal-cell-selected' : ''}"
        data-cal-date="${cell.solarDay}-${cell.solarMonth}-${cell.solarYear}"
      >
        <div class="cal-cell-top">
          <span class="cal-solar-num">${cell.solarDay}</span>
          <span class="cal-auspicious-dot ${
            cell.auspicious.status === 'Hoàng Đạo' ? 'dot-hoang-dao' : 'dot-hac-dao'
          }" title="Ngày ${cell.auspicious.status}"></span>
        </div>
        <div class="cal-cell-bottom">
          <span class="cal-lunar-num ${isFirstOrFull ? 'lunar-highlight' : ''}">
            ${lunarLabel}
          </span>
        </div>
      </button>
    `;
  }

  private bindEvents(): void {
    this.container.querySelector('#cal-prev-month')?.addEventListener('click', () => {
      this.viewMonth -= 1;
      if (this.viewMonth < 1) {
        this.viewMonth = 12;
        this.viewYear -= 1;
      }
      this.render();
    });

    this.container.querySelector('#cal-next-month')?.addEventListener('click', () => {
      this.viewMonth += 1;
      if (this.viewMonth > 12) {
        this.viewMonth = 1;
        this.viewYear += 1;
      }
      this.render();
    });

    this.container.querySelector('#cal-today-btn')?.addEventListener('click', () => {
      const today = getVietnamToday();
      this.viewYear = today.year;
      this.viewMonth = today.month;
      this.selectedDay = getDayDetails(today.day, today.month, today.year, true, today.isoDate);
      this.render();
    });

    const dayCells = this.container.querySelectorAll<HTMLButtonElement>('[data-cal-date]');
    dayCells.forEach((btn) => {
      btn.addEventListener('click', () => {
        const raw = btn.getAttribute('data-cal-date');
        if (!raw) return;
        const [d, m, y] = raw.split('-').map(Number);
        this.viewYear = y;
        this.viewMonth = m;
        this.selectedDay = getDayDetails(d, m, y, true);
        this.render();
      });
    });

    this.container
      .querySelector('#cal-create-lunar-rem-btn')
      ?.addEventListener('click', () => {
        this.callbacks.onCreateLunarReminderForDate(
          this.selectedDay.lunar.day,
          this.selectedDay.lunar.month
        );
      });

    // Solar -> Lunar Converter
    this.container.querySelector('#conv-s2l-btn')?.addEventListener('click', () => {
      const d = Number(
        this.container.querySelector<HTMLInputElement>('#conv-s2l-day')?.value || 1
      );
      const m = Number(
        this.container.querySelector<HTMLInputElement>('#conv-s2l-month')?.value || 1
      );
      const y = Number(
        this.container.querySelector<HTMLInputElement>('#conv-s2l-year')?.value || 2026
      );

      const testDate = new Date(y, m - 1, d);
      if (
        testDate.getFullYear() !== y ||
        testDate.getMonth() + 1 !== m ||
        testDate.getDate() !== d
      ) {
        toast.show('Invalid solar calendar date.', 'error');
        return;
      }

      const lunar = convertSolar2Lunar(d, m, y);
      const canChi = getCanChiInfo(lunar);
      const ausp = getAuspiciousInfo(lunar.month, canChi.dayBranchIndex);

      this.convSolarResultText = `Lunar: ${lunar.day}/${lunar.month}/${lunar.year}${
        lunar.isLeapMonth ? ' (Tháng Nhuận)' : ''
      } • Năm ${canChi.yearCanChi}, Tháng ${canChi.monthCanChi}, Ngày ${
        canChi.dayCanChi
      } (${ausp.status})`;

      const resEl = this.container.querySelector('#conv-s2l-result');
      if (resEl) {
        resEl.textContent = this.convSolarResultText;
      }
    });

    // Lunar -> Solar Converter
    this.container.querySelector('#conv-l2s-btn')?.addEventListener('click', () => {
      const lDay = Number(
        this.container.querySelector<HTMLInputElement>('#conv-l2s-day')?.value || 1
      );
      const lMonth = Number(
        this.container.querySelector<HTMLInputElement>('#conv-l2s-month')?.value || 1
      );
      const lYear = Number(
        this.container.querySelector<HTMLInputElement>('#conv-l2s-year')?.value || 2026
      );
      const isLeap = Boolean(
        this.container.querySelector<HTMLInputElement>('#conv-l2s-leap')?.checked
      );

      const solar = convertLunar2Solar(lDay, lMonth, lYear, isLeap);
      const resEl = this.container.querySelector('#conv-l2s-result');

      if (solar.day === 0) {
        this.convLunarResultText = isLeap
          ? `Lunar Year ${lYear} does not have a leap month ${lMonth} (or day ${lDay} exceeds month length).`
          : `Invalid Lunar date ${lDay}/${lMonth}/${lYear}.`;
        if (resEl) resEl.textContent = this.convLunarResultText;
        toast.show(this.convLunarResultText, 'error');
        return;
      }

      const verifyLunar = convertSolar2Lunar(solar.day, solar.month, solar.year);
      const canChi = getCanChiInfo(verifyLunar);
      this.convLunarResultText = `Solar Date: ${solar.day}/${solar.month}/${solar.year} • Ngày ${canChi.dayCanChi}, Tháng ${canChi.monthCanChi}, Năm ${canChi.yearCanChi}`;
      if (resEl) {
        resEl.textContent = this.convLunarResultText;
      }
    });
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
