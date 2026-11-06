/**
 * Vietnamese Lunar Calendar Engine (Renderer Module)
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

const THANH_LONG_START_BY_MONTH: Record<number, number> = {
  1: 0,
  2: 2,
  3: 4,
  4: 6,
  5: 8,
  6: 10,
  7: 0,
  8: 2,
  9: 4,
  10: 6,
  11: 8,
  12: 10
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
  0: [0, 1, 3, 6, 8, 9],
  6: [0, 1, 3, 6, 8, 9],
  1: [2, 3, 5, 8, 10, 11],
  7: [2, 3, 5, 8, 10, 11],
  2: [0, 1, 4, 5, 7, 10],
  8: [0, 1, 4, 5, 7, 10],
  3: [0, 2, 3, 6, 7, 9],
  9: [0, 2, 3, 6, 7, 9],
  4: [2, 4, 5, 8, 9, 11],
  10: [2, 4, 5, 8, 9, 11],
  5: [1, 4, 6, 7, 10, 11],
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

export function buildMonthlyCalendar(solarYear: number, solarMonth: number): CalendarDayDetails[] {
  const todayIso = getVietnamToday().isoDate;
  const firstDayOfMonth = new Date(solarYear, solarMonth - 1, 1);
  const startOffset = (firstDayOfMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(solarYear, solarMonth, 0).getDate();

  const prevMonthDate = new Date(solarYear, solarMonth - 1, 0);
  const prevMonthDays = prevMonthDate.getDate();
  const prevMonth = prevMonthDate.getMonth() + 1;
  const prevYear = prevMonthDate.getFullYear();

  const cells: CalendarDayDetails[] = [];

  for (let i = startOffset - 1; i >= 0; i--) {
    const d = prevMonthDays - i;
    cells.push(getDayDetails(d, prevMonth, prevYear, false, todayIso));
  }

  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(getDayDetails(d, solarMonth, solarYear, true, todayIso));
  }

  const nextMonthDate = new Date(solarYear, solarMonth, 1);
  const nextMonth = nextMonthDate.getMonth() + 1;
  const nextYear = nextMonthDate.getFullYear();
  let nextDay = 1;
  while (cells.length < 42) {
    cells.push(getDayDetails(nextDay++, nextMonth, nextYear, false, todayIso));
  }

  return cells;
}
