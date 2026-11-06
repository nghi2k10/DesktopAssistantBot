/**
 * Vietnamese Lunar Calendar Engine
 * Based on the astronomical algorithm by Hồ Ngọc Đức (UTC+7 Vietnam Standard Time).
 * Pure offline calculation — zero external APIs.
 */

export const VIETNAM_TIMEZONE = 7.0;

export type LeapMonthPolicy = 'regular_only' | 'leap_only' | 'both';

export interface LunarDateResult {
  day: number;
  month: number;
  year: number;
  isLeapMonth: boolean;
  jd: number;
}

export interface SolarDateResult {
  day: number;
  month: number;
  year: number;
  jd: number;
}

export interface CanChiInfo {
  dayCanChi: string;
  monthCanChi: string;
  yearCanChi: string;
  dayBranchIndex: number;
  dayBranchName: string;
}

export interface AuspiciousDayInfo {
  status: 'Hoàng Đạo' | 'Hắc Đạo';
  starName: string;
  ruleExplanation: string;
  auspiciousHours: string[];
}

export interface CalendarDayDetails {
  solarDay: number;
  solarMonth: number;
  solarYear: number;
  isoDate: string;
  isCurrentMonth: boolean;
  isToday: boolean;
  lunar: LunarDateResult;
  canChi: CanChiInfo;
  auspicious: AuspiciousDayInfo;
  holidayOrSolarTerm?: string;
}

const THIEN_CAN = [
  'Giáp',
  'Ất',
  'Bính',
  'Đinh',
  'Mậu',
  'Kỷ',
  'Canh',
  'Tân',
  'Nhâm',
  'Quý'
] as const;

const DIA_CHI = [
  'Tý',
  'Sửu',
  'Dần',
  'Mão',
  'Thìn',
  'Tỵ',
  'Ngọ',
  'Mùi',
  'Thân',
  'Dậu',
  'Tuất',
  'Hợi'
] as const;

const GIO_DIA_CHI_RANGES: Record<string, string> = {
  Tý: '23:00-01:00',
  Sửu: '01:00-03:00',
  Dần: '03:00-05:00',
  Mão: '05:00-07:00',
  Thìn: '07:00-09:00',
  Tỵ: '09:00-11:00',
  Ngọ: '11:00-13:00',
  Mùi: '13:00-15:00',
  Thân: '15:00-17:00',
  Dậu: '17:00-19:00',
  Tuất: '19:00-21:00',
  Hợi: '21:00-23:00'
};

/**
 * Explicit traditional 12-star (Thập Nhị Kiến Trừ / Hoàng Đạo - Hắc Đạo) table.
 * For each Lunar Month (1..12), maps the starting Earthly Branch index (0=Tý..11=Hợi) of Thanh Long.
 * Offset from starting branch (mod 12):
 * 0: Thanh Long (Hoàng Đạo)
 * 1: Minh Đường (Hoàng Đạo)
 * 2: Thiên Hình (Hắc Đạo)
 * 3: Chu Tước (Hắc Đạo)
 * 4: Kim Quỹ (Hoàng Đạo)
 * 5: Bảo Quang / Thiên Đức (Hoàng Đạo)
 * 6: Bạch Hổ (Hắc Đạo)
 * 7: Ngọc Đường (Hoàng Đạo)
 * 8: Thiên Lao (Hắc Đạo)
 * 9: Nguyên Vũ (Hắc Đạo)
 * 10: Tư Mệnh (Hoàng Đạo)
 * 11: Câu Trận (Hắc Đạo)
 */
const THANH_LONG_START_BY_MONTH: Record<number, number> = {
  1: 0,  // Tý
  2: 2,  // Dần
  3: 4,  // Thìn
  4: 6,  // Ngọ
  5: 8,  // Thân
  6: 10, // Tuất
  7: 0,  // Tý
  8: 2,  // Dần
  9: 4,  // Thìn
  10: 6, // Ngọ
  11: 8, // Thân
  12: 10 // Tuất
};

const TWELVE_STARS: Array<{ name: string; isHoangDao: boolean }> = [
  { name: 'Thanh Long Hoàng Đạo', isHoangDao: true },
  { name: 'Minh Đường Hoàng Đạo', isHoangDao: true },
  { name: 'Thiên Hình Hắc Đạo', isHoangDao: false },
  { name: 'Chu Tước Hắc Đạo', isHoangDao: false },
  { name: 'Kim Quỹ Hoàng Đạo', isHoangDao: true },
  { name: 'Bảo Quang Hoàng Đạo', isHoangDao: true },
  { name: 'Bạch Hổ Hắc Đạo', isHoangDao: false },
  { name: 'Ngọc Đường Hoàng Đạo', isHoangDao: true },
  { name: 'Thiên Lao Hắc Đạo', isHoangDao: false },
  { name: 'Nguyên Vũ Hắc Đạo', isHoangDao: false },
  { name: 'Tư Mệnh Hoàng Đạo', isHoangDao: true },
  { name: 'Câu Trận Hắc Đạo', isHoangDao: false }
];

const HOANG_DAO_HOURS_BY_DAY_BRANCH: Record<number, number[]> = {
  0: [0, 1, 3, 6, 8, 9],   // Tý, Ngọ -> Tý, Sửu, Mão, Ngọ, Thân, Dậu
  6: [0, 1, 3, 6, 8, 9],
  1: [2, 3, 5, 8, 10, 11], // Sửu, Mùi -> Dần, Mão, Tỵ, Thân, Tuất, Hợi
  7: [2, 3, 5, 8, 10, 11],
  2: [0, 1, 4, 5, 7, 10],  // Dần, Thân -> Tý, Sửu, Thìn, Tỵ, Mùi, Tuất
  8: [0, 1, 4, 5, 7, 10],
  3: [0, 2, 3, 6, 7, 9],   // Mão, Dậu -> Tý, Dần, Mão, Ngọ, Mùi, Dậu
  9: [0, 2, 3, 6, 7, 9],
  4: [2, 4, 5, 8, 9, 11],  // Thìn, Tuất -> Dần, Thìn, Tỵ, Thân, Dậu, Hợi
  10: [2, 4, 5, 8, 9, 11],
  5: [1, 4, 6, 7, 10, 11], // Tỵ, Hợi -> Sửu, Thìn, Ngọ, Mùi, Tuất, Hợi
  11: [1, 4, 6, 7, 10, 11]
};

const TRADITIONAL_LUNAR_HOLIDAYS: Record<string, string> = {
  '1-1': 'Tết Nguyên Đán (Mùng 1 Tết)',
  '2-1': 'Mùng 2 Tết Nguyên Đán',
  '3-1': 'Mùng 3 Tết Nguyên Đán',
  '15-1': 'Tết Nguyên Tiêu (Rằm tháng Giêng)',
  '3-3': 'Tết Hàn Thực',
  '10-3': 'Giỗ Tổ Hùng Vương',
  '15-4': 'Lễ Phật Đản (Rằm tháng Tư)',
  '5-5': 'Tết Đoan Ngọ',
  '15-7': 'Lễ Vu Lan (Rằm tháng Bảy)',
  '15-8': 'Tết Trung Thu (Rằm tháng Tám)',
  '23-12': 'Tiễn Ông Công Ông Táo'
};

function INT(d: number): number {
  return Math.floor(d);
}

/**
 * Compute Julian Day Number from solar DD/MM/YYYY.
 */
export function jdFromDate(dd: number, mm: number, yy: number): number {
  const a = INT((14 - mm) / 12);
  const y = yy + 4800 - a;
  const m = mm + 12 * a - 3;
  let jd =
    dd +
    INT((153 * m + 2) / 5) +
    365 * y +
    INT(y / 4) -
    INT(y / 100) +
    INT(y / 400) -
    32045;
  if (jd < 2299161) {
    jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - 32083;
  }
  return jd;
}

/**
 * Convert Julian Day Number back to solar [dd, mm, yyyy].
 */
export function jdToDate(jd: number): [number, number, number] {
  let a: number;
  let b: number;
  let c: number;
  if (jd > 2299160) {
    a = jd + 32044;
    b = INT((4 * a + 3) / 146097);
    c = a - INT((b * 146097) / 4);
  } else {
    b = 0;
    c = jd + 32082;
  }
  const d = INT((4 * c + 3) / 1461);
  const e = c - INT((1461 * d) / 4);
  const m = INT((5 * e + 2) / 153);
  const day = e - INT((153 * m + 2) / 5) + 1;
  const month = m + 3 - 12 * INT(m / 10);
  const year = b * 100 + d - 4800 + INT(m / 10);
  return [day, month, year];
}

/**
 * Compute the Julian Day Number of the k-th New Moon since 1900-01-01.
 */
export function getNewMoonDay(k: number, timeZone: number = VIETNAM_TIMEZONE): number {
  const T = k / 1236.85;
  const T2 = T * T;
  const T3 = T2 * T;
  const dr = Math.PI / 180;
  let Jd1 =
    2415020.75933 +
    29.53058868 * k +
    0.0001178 * T2 -
    0.000000155 * T3;
  Jd1 = Jd1 + 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
  const M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
  const Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
  const F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
  let C1 =
    (0.1734 - 0.000393 * T) * Math.sin(M * dr) +
    0.0021 * Math.sin(2 * dr * M);
  C1 = C1 - 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(dr * 2 * Mpr);
  C1 = C1 - 0.0004 * Math.sin(dr * 3 * Mpr);
  C1 = C1 + 0.0104 * Math.sin(dr * 2 * F) - 0.0051 * Math.sin(dr * (M + Mpr));
  C1 =
    C1 -
    0.0074 * Math.sin(dr * (M - Mpr)) +
    0.0004 * Math.sin(dr * (2 * F + M));
  C1 =
    C1 -
    0.0004 * Math.sin(dr * (2 * F - M)) -
    0.0006 * Math.sin(dr * (2 * F + Mpr));
  C1 =
    C1 +
    0.001 * Math.sin(dr * (2 * F - Mpr)) +
    0.0005 * Math.sin(dr * (2 * Mpr + M));
  let deltat: number;
  if (T < -11) {
    deltat =
      0.001 +
      0.000839 * T +
      0.0002261 * T2 -
      0.00000845 * T3 -
      0.000000081 * T * T3;
  } else {
    deltat = -0.000278 + 0.000265 * T + 0.000262 * T2;
  }
  const JdNew = Jd1 + C1 - deltat;
  return INT(JdNew + 0.5 + timeZone / 24);
}

/**
 * Compute Sun longitude sector (0..11) at midnight local time for Julian Day jdn.
 */
export function getSunLongitude(jdn: number, timeZone: number = VIETNAM_TIMEZONE): number {
  const T = (jdn - 2451545.5 - timeZone / 24) / 36525;
  const T2 = T * T;
  const dr = Math.PI / 180;
  const M = 357.5291 + 35999.0503 * T - 0.0001559 * T2 - 0.00000048 * T * T2;
  const L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
  let DL = (1.9146 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M);
  DL =
    DL +
    (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) +
    0.00029 * Math.sin(dr * 3 * M);
  let L = L0 + DL;
  L = L * dr;
  L = L - Math.PI * 2 * INT(L / (Math.PI * 2));
  return INT((L / Math.PI) * 6);
}

/**
 * Find the Julian Day Number of Lunar Month 11 (containing Winter Solstice) for year yy.
 */
export function getLunarMonth11(yy: number, timeZone: number = VIETNAM_TIMEZONE): number {
  const off = jdFromDate(31, 12, yy) - 2415021;
  const k = INT(off / 29.530588853);
  let nm = getNewMoonDay(k, timeZone);
  const sunLong = getSunLongitude(nm, timeZone);
  if (sunLong >= 9) {
    nm = getNewMoonDay(k - 1, timeZone);
  }
  return nm;
}

/**
 * Determine the offset of the leap month after Month 11 starting at Julian Day a11.
 */
export function getLeapMonthOffset(a11: number, timeZone: number = VIETNAM_TIMEZONE): number {
  const k = INT((a11 - 2415021.076998695) / 29.530588853 + 0.5);
  let last = 0;
  let i = 1;
  let arc = getSunLongitude(getNewMoonDay(k + i, timeZone), timeZone);
  do {
    last = arc;
    i++;
    arc = getSunLongitude(getNewMoonDay(k + i, timeZone), timeZone);
  } while (arc !== last && i < 14);
  return i - 1;
}

/**
 * Convert Solar Date (dd, mm, yy) to Vietnamese Lunar Date (UTC+7).
 */
export function convertSolar2Lunar(
  dd: number,
  mm: number,
  yy: number,
  timeZone: number = VIETNAM_TIMEZONE
): LunarDateResult {
  const dayNumber = jdFromDate(dd, mm, yy);
  const k = INT((dayNumber - 2415021.076998695) / 29.530588853);
  let monthStart = getNewMoonDay(k + 1, timeZone);
  if (monthStart > dayNumber) {
    monthStart = getNewMoonDay(k, timeZone);
  }
  let a11 = getLunarMonth11(yy, timeZone);
  let b11 = a11;
  let lunarYear: number;
  if (a11 >= monthStart) {
    lunarYear = yy;
    a11 = getLunarMonth11(yy - 1, timeZone);
  } else {
    lunarYear = yy + 1;
    b11 = getLunarMonth11(yy + 1, timeZone);
  }
  const lunarDay = dayNumber - monthStart + 1;
  const diff = INT((monthStart - a11) / 29);
  let lunarLeap = false;
  let lunarMonth = diff + 11;
  if (b11 - a11 > 365) {
    const leapMonthDiff = getLeapMonthOffset(a11, timeZone);
    if (diff >= leapMonthDiff) {
      lunarMonth = diff + 10;
      if (diff === leapMonthDiff) {
        lunarLeap = true;
      }
    }
  }
  if (lunarMonth > 12) {
    lunarMonth = lunarMonth - 12;
  }
  if (lunarMonth >= 11 && diff < 4) {
    lunarYear -= 1;
  }
  return {
    day: lunarDay,
    month: lunarMonth,
    year: lunarYear,
    isLeapMonth: lunarLeap,
    jd: dayNumber
  };
}

/**
 * Convert Vietnamese Lunar Date to Solar Date (UTC+7).
 * Returns { day: 0, month: 0, year: 0, jd: 0 } if the specified lunar date is invalid
 * (for example, requesting a leap month in a year where that month is not leap).
 */
export function convertLunar2Solar(
  lunarDay: number,
  lunarMonth: number,
  lunarYear: number,
  lunarLeap: boolean,
  timeZone: number = VIETNAM_TIMEZONE
): SolarDateResult {
  if (lunarMonth < 1 || lunarMonth > 12 || lunarDay < 1 || lunarDay > 30) {
    return { day: 0, month: 0, year: 0, jd: 0 };
  }

  let a11: number;
  let b11: number;
  if (lunarMonth < 11) {
    a11 = getLunarMonth11(lunarYear - 1, timeZone);
    b11 = getLunarMonth11(lunarYear, timeZone);
  } else {
    a11 = getLunarMonth11(lunarYear, timeZone);
    b11 = getLunarMonth11(lunarYear + 1, timeZone);
  }
  const k = INT(0.5 + (a11 - 2415021.076998695) / 29.530588853);
  let off = lunarMonth - 11;
  if (off < 0) {
    off += 12;
  }
  if (b11 - a11 > 365) {
    const leapOff = getLeapMonthOffset(a11, timeZone);
    let leapMonth = leapOff - 2;
    if (leapMonth < 0) {
      leapMonth += 12;
    }
    if (lunarLeap && lunarMonth !== leapMonth) {
      return { day: 0, month: 0, year: 0, jd: 0 };
    } else if (lunarLeap || off >= leapOff) {
      off += 1;
    }
  } else if (lunarLeap) {
    return { day: 0, month: 0, year: 0, jd: 0 };
  }

  const monthStart = getNewMoonDay(k + off, timeZone);
  const nextMonthStart = getNewMoonDay(k + off + 1, timeZone);
  const maxDaysInMonth = nextMonthStart - monthStart;
  if (lunarDay > maxDaysInMonth) {
    return { day: 0, month: 0, year: 0, jd: 0 };
  }

  const jd = monthStart + lunarDay - 1;
  const [day, month, year] = jdToDate(jd);
  return { day, month, year, jd };
}

/**
 * Compute Can Chi (Heavenly Stem & Earthly Branch) for Day, Month, and Year.
 */
export function getCanChiInfo(lunar: LunarDateResult): CanChiInfo {
  const yearCan = THIEN_CAN[(lunar.year + 6) % 10];
  const yearChi = DIA_CHI[(lunar.year + 8) % 12];
  const yearCanChi = `${yearCan} ${yearChi}`;

  const monthCan = THIEN_CAN[(lunar.year * 12 + lunar.month + 3) % 10];
  const monthChi = DIA_CHI[(lunar.month + 1) % 12];
  const monthCanChi = `${monthCan} ${monthChi}${lunar.isLeapMonth ? ' (Nhuận)' : ''}`;

  const dayCan = THIEN_CAN[(lunar.jd + 9) % 10];
  const dayBranchIndex = (lunar.jd + 1) % 12;
  const dayBranchName = DIA_CHI[dayBranchIndex];
  const dayCanChi = `${dayCan} ${dayBranchName}`;

  return {
    dayCanChi,
    monthCanChi,
    yearCanChi,
    dayBranchIndex,
    dayBranchName
  };
}

/**
 * Compute Traditional Hoàng Đạo / Hắc Đạo Day & Auspicious Hours using the explicit local rule set.
 */
export function getAuspiciousInfo(lunarMonth: number, dayBranchIndex: number): AuspiciousDayInfo {
  const startBranch = THANH_LONG_START_BY_MONTH[lunarMonth] ?? 0;
  const starOffset = (dayBranchIndex - startBranch + 12) % 12;
  const star = TWELVE_STARS[starOffset];

  const hourIndices = HOANG_DAO_HOURS_BY_DAY_BRANCH[dayBranchIndex] || [0, 1, 3, 6, 8, 9];
  const auspiciousHours = hourIndices.map((idx) => {
    const chiName = DIA_CHI[idx];
    return `${chiName} (${GIO_DIA_CHI_RANGES[chiName]})`;
  });

  return {
    status: star.isHoangDao ? 'Hoàng Đạo' : 'Hắc Đạo',
    starName: star.name,
    ruleExplanation: `Rule: Thập Nhị Kiến Trừ table (Lunar Month ${lunarMonth} + Day Branch ${DIA_CHI[dayBranchIndex]} -> ${star.name})`,
    auspiciousHours
  };
}

/**
 * Get current date components in Vietnam Timezone (UTC+7).
 */
export function getVietnamToday(now: Date = new Date()): {
  day: number;
  month: number;
  year: number;
  isoDate: string;
} {
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const vnDate = new Date(utcMs + VIETNAM_TIMEZONE * 3600000);
  const year = vnDate.getFullYear();
  const month = vnDate.getMonth() + 1;
  const day = vnDate.getDate();
  const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { day, month, year, isoDate };
}

/**
 * Build full details for a single Solar Date.
 */
export function getDayDetails(
  solarDay: number,
  solarMonth: number,
  solarYear: number,
  isCurrentMonth = true,
  todayIso?: string
): CalendarDayDetails {
  const today = todayIso || getVietnamToday().isoDate;
  const isoDate = `${solarYear}-${String(solarMonth).padStart(2, '0')}-${String(solarDay).padStart(2, '0')}`;
  const lunar = convertSolar2Lunar(solarDay, solarMonth, solarYear);
  const canChi = getCanChiInfo(lunar);
  const auspicious = getAuspiciousInfo(lunar.month, canChi.dayBranchIndex);

  let holidayOrSolarTerm: string | undefined;
  if (!lunar.isLeapMonth) {
    holidayOrSolarTerm = TRADITIONAL_LUNAR_HOLIDAYS[`${lunar.day}-${lunar.month}`];
  }
  if (!holidayOrSolarTerm && lunar.day === 1) {
    holidayOrSolarTerm = `Mùng 1 tháng ${lunar.month}${lunar.isLeapMonth ? ' (Nhuận)' : ''}`;
  } else if (!holidayOrSolarTerm && lunar.day === 15) {
    holidayOrSolarTerm = `Rằm tháng ${lunar.month}${lunar.isLeapMonth ? ' (Nhuận)' : ''}`;
  }

  return {
    solarDay,
    solarMonth,
    solarYear,
    isoDate,
    isCurrentMonth,
    isToday: isoDate === today,
    lunar,
    canChi,
    auspicious,
    holidayOrSolarTerm
  };
}

/**
 * Build a 42-cell (6 weeks, Monday-first) monthly calendar grid for a given solar year and month (1..12).
 */
export function buildMonthlyCalendar(solarYear: number, solarMonth: number): CalendarDayDetails[] {
  const todayIso = getVietnamToday().isoDate;
  const firstDayOfMonth = new Date(solarYear, solarMonth - 1, 1);
  // Convert Sunday=0..Saturday=6 to Monday=0..Sunday=6
  const startOffset = (firstDayOfMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(solarYear, solarMonth, 0).getDate();

  const prevMonthDate = new Date(solarYear, solarMonth - 1, 0);
  const prevMonthDays = prevMonthDate.getDate();
  const prevMonth = prevMonthDate.getMonth() + 1;
  const prevYear = prevMonthDate.getFullYear();

  const cells: CalendarDayDetails[] = [];

  // Leading days from previous month
  for (let i = startOffset - 1; i >= 0; i--) {
    const d = prevMonthDays - i;
    cells.push(getDayDetails(d, prevMonth, prevYear, false, todayIso));
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(getDayDetails(d, solarMonth, solarYear, true, todayIso));
  }

  // Trailing days from next month to fill 42 cells
  const nextMonthDate = new Date(solarYear, solarMonth, 1);
  const nextMonth = nextMonthDate.getMonth() + 1;
  const nextYear = nextMonthDate.getFullYear();
  let nextDay = 1;
  while (cells.length < 42) {
    cells.push(getDayDetails(nextDay++, nextMonth, nextYear, false, todayIso));
  }

  return cells;
}

/**
 * Resolve a lunar day/month in a given lunar year & leap flag, clamping day 30 to day 29
 * if that specific lunar month only has 29 days (tháng thiếu).
 */
function resolveLunarInYear(
  lunarDay: number,
  lunarMonth: number,
  lunarYear: number,
  isLeap: boolean
): SolarDateResult | null {
  let res = convertLunar2Solar(lunarDay, lunarMonth, lunarYear, isLeap);
  if (res.day === 0 && lunarDay === 30) {
    res = convertLunar2Solar(29, lunarMonth, lunarYear, isLeap);
  }
  return res.day > 0 ? res : null;
}

/**
 * Compute the next Solar Date & ISO timestamp occurrence for a Lunar Reminder
 * respecting `leap_month_policy` ('regular_only' | 'leap_only' | 'both').
 */
export function computeNextLunarReminderOccurrence(
  lunarDay: number,
  lunarMonth: number,
  leapPolicy: LeapMonthPolicy,
  triggerTime = '08:00',
  referenceDate: Date = new Date()
): {
  solarDay: number;
  solarMonth: number;
  solarYear: number;
  isoDate: string;
  triggerAtIso: string;
  lunarYear: number;
  isLeapOccurrence: boolean;
} {
  const todayLunar = convertSolar2Lunar(
    referenceDate.getDate(),
    referenceDate.getMonth() + 1,
    referenceDate.getFullYear()
  );

  const [hoursStr, minutesStr] = triggerTime.split(':');
  const hours = Number(hoursStr) || 8;
  const minutes = Number(minutesStr) || 0;

  const candidates: Array<{
    solar: SolarDateResult;
    lunarYear: number;
    isLeapOccurrence: boolean;
    triggerDate: Date;
  }> = [];

  for (let yOffset = 0; yOffset <= 3; yOffset++) {
    const lYear = todayLunar.year + yOffset;
    const regularSolar = resolveLunarInYear(lunarDay, lunarMonth, lYear, false);
    const leapSolar = resolveLunarInYear(lunarDay, lunarMonth, lYear, true);

    const chosenForYear: Array<{ solar: SolarDateResult; isLeap: boolean }> = [];
    if (leapPolicy === 'regular_only') {
      if (regularSolar) chosenForYear.push({ solar: regularSolar, isLeap: false });
    } else if (leapPolicy === 'leap_only') {
      if (leapSolar) {
        chosenForYear.push({ solar: leapSolar, isLeap: true });
      } else if (regularSolar) {
        chosenForYear.push({ solar: regularSolar, isLeap: false });
      }
    } else {
      // 'both'
      if (regularSolar) chosenForYear.push({ solar: regularSolar, isLeap: false });
      if (leapSolar) chosenForYear.push({ solar: leapSolar, isLeap: true });
    }

    for (const item of chosenForYear) {
      const triggerDate = new Date(
        item.solar.year,
        item.solar.month - 1,
        item.solar.day,
        hours,
        minutes,
        0,
        0
      );
      candidates.push({
        solar: item.solar,
        lunarYear: lYear,
        isLeapOccurrence: item.isLeap,
        triggerDate
      });
    }
  }

  candidates.sort((a, b) => a.triggerDate.getTime() - b.triggerDate.getTime());

  const upcoming =
    candidates.find((c) => c.triggerDate.getTime() >= referenceDate.getTime() - 60000) ||
    candidates[candidates.length - 1];

  const { solar, lunarYear, isLeapOccurrence, triggerDate } = upcoming;
  const isoDate = `${solar.year}-${String(solar.month).padStart(2, '0')}-${String(solar.day).padStart(2, '0')}`;
  const pad = (n: number) => String(n).padStart(2, '0');
  const triggerAtIso = `${solar.year}-${pad(solar.month)}-${pad(solar.day)}T${pad(triggerDate.getHours())}:${pad(triggerDate.getMinutes())}`;

  return {
    solarDay: solar.day,
    solarMonth: solar.month,
    solarYear: solar.year,
    isoDate,
    triggerAtIso,
    lunarYear,
    isLeapOccurrence
  };
}

/**
 * Verify known Vietnamese Lunar Calendar dates (including leap months and Tết Nguyên Đán).
 */
export function verifyKnownLunarDates(): {
  allPassed: boolean;
  details: string[];
} {
  const testCases = [
    // 1. Tết Quý Mão 2023: Solar 22/01/2023 -> Lunar 01/01/2023 (Regular)
    {
      solar: [22, 1, 2023] as const,
      expectedLunar: { day: 1, month: 1, year: 2023, isLeapMonth: false }
    },
    // 2. Leap Month 2 in 2023 (Quý Mão): Solar 22/03/2023 -> Lunar 01/02/2023 (Leap = true)
    {
      solar: [22, 3, 2023] as const,
      expectedLunar: { day: 1, month: 2, year: 2023, isLeapMonth: true }
    },
    // 3. Tết Giáp Thìn 2024: Solar 10/02/2024 -> Lunar 01/01/2024
    {
      solar: [10, 2, 2024] as const,
      expectedLunar: { day: 1, month: 1, year: 2024, isLeapMonth: false }
    },
    // 4. Tết Ất Tỵ 2025: Solar 29/01/2025 -> Lunar 01/01/2025
    {
      solar: [29, 1, 2025] as const,
      expectedLunar: { day: 1, month: 1, year: 2025, isLeapMonth: false }
    },
    // 5. Leap Month 6 in 2025 (Ất Tỵ): Solar 25/07/2025 -> Lunar 01/06/2025 (Leap = true)
    {
      solar: [25, 7, 2025] as const,
      expectedLunar: { day: 1, month: 6, year: 2025, isLeapMonth: true }
    },
    // 6. Tết Bính Ngọ 2026: Solar 17/02/2026 -> Lunar 01/01/2026
    {
      solar: [17, 2, 2026] as const,
      expectedLunar: { day: 1, month: 1, year: 2026, isLeapMonth: false }
    }
  ];

  const details: string[] = [];
  let allPassed = true;

  for (const tc of testCases) {
    const [sDay, sMonth, sYear] = tc.solar;
    const lunar = convertSolar2Lunar(sDay, sMonth, sYear);
    const matchesLunar =
      lunar.day === tc.expectedLunar.day &&
      lunar.month === tc.expectedLunar.month &&
      lunar.year === tc.expectedLunar.year &&
      lunar.isLeapMonth === tc.expectedLunar.isLeapMonth;

    const roundTripSolar = convertLunar2Solar(
      lunar.day,
      lunar.month,
      lunar.year,
      lunar.isLeapMonth
    );
    const matchesSolar =
      roundTripSolar.day === sDay &&
      roundTripSolar.month === sMonth &&
      roundTripSolar.year === sYear;

    const passed = matchesLunar && matchesSolar;
    if (!passed) {
      allPassed = false;
    }

    details.push(
      `Solar ${sDay}/${sMonth}/${sYear} <-> Lunar ${lunar.day}/${lunar.month}/${lunar.year}${
        lunar.isLeapMonth ? '(Leap)' : ''
      }: ${passed ? 'OK' : 'FAIL'}`
    );
  }

  return { allPassed, details };
}
