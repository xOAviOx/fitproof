import { DEGREE_LEVELS, type DegreeLevel } from "./vocab";

/**
 * Small, explicit vocabularies for matching free-text cities, degrees, and branches.
 * Anything not recognized here is treated as unknown, and unknown never excludes a job.
 */

export function normalizeTerm(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

type Dictionary<K extends string> = readonly { key: K; aliases: readonly string[] }[];

export function termMatcher<K extends string>(dictionary: Dictionary<K>) {
  // Longest aliases first, and each match is blanked out, so "electrical and electronics"
  // is not also read as "electronics".
  const entries = dictionary
    .flatMap(({ key, aliases }) => aliases.map((alias) => ({ key, alias: ` ${normalizeTerm(alias)} ` })))
    .sort((a, b) => b.alias.length - a.alias.length);
  return (text: string): K[] => {
    let remaining = ` ${normalizeTerm(text)} `;
    const found = new Set<K>();
    for (const { key, alias } of entries) {
      if (!remaining.includes(alias)) continue;
      found.add(key);
      remaining = remaining.replaceAll(alias, " ; ");
    }
    return [...found];
  };
}

const CITIES = [
  {
    key: "Bengaluru",
    aliases: [
      "Bengaluru",
      "Bangalore",
      "BLR",
      "Bengaluru Urban",
      "Bangalore Urban",
      "Whitefield",
      "Electronic City",
      "Koramangala",
      "Bellandur",
      "Marathahalli",
    ],
  },
  {
    key: "Hyderabad",
    aliases: [
      "Hyderabad",
      "Secunderabad",
      "Cyberabad",
      "HYD",
      "Gachibowli",
      "HITEC City",
      "Hitech City",
      "Madhapur",
      "Kondapur",
      "Nanakramguda",
    ],
  },
  {
    key: "Pune",
    aliases: [
      "Pune",
      "Poona",
      "Pimpri Chinchwad",
      "Hinjewadi",
      "Kharadi",
      "Magarpatta",
      "Baner",
      "Viman Nagar",
      "Hadapsar",
      "Wakad",
    ],
  },
  { key: "Mumbai", aliases: ["Mumbai", "Bombay", "Navi Mumbai", "Thane"] },
  { key: "Delhi", aliases: ["Delhi", "New Delhi"] },
  { key: "Gurugram", aliases: ["Gurugram", "Gurgaon"] },
  { key: "Noida", aliases: ["Noida", "Greater Noida"] },
  { key: "Chennai", aliases: ["Chennai", "Madras"] },
  { key: "Kolkata", aliases: ["Kolkata", "Calcutta"] },
  { key: "Ahmedabad", aliases: ["Ahmedabad"] },
  { key: "Kochi", aliases: ["Kochi", "Cochin"] },
  { key: "Thiruvananthapuram", aliases: ["Thiruvananthapuram", "Trivandrum"] },
  { key: "Coimbatore", aliases: ["Coimbatore"] },
  { key: "Mysuru", aliases: ["Mysuru", "Mysore"] },
  { key: "Jaipur", aliases: ["Jaipur"] },
  { key: "Chandigarh", aliases: ["Chandigarh", "Mohali"] },
  { key: "Indore", aliases: ["Indore"] },
  { key: "Nagpur", aliases: ["Nagpur"] },
  { key: "Lucknow", aliases: ["Lucknow"] },
  { key: "Bhubaneswar", aliases: ["Bhubaneswar"] },
  { key: "Visakhapatnam", aliases: ["Visakhapatnam", "Vizag"] },
] as const satisfies Dictionary<string>;
export type KnownCity = (typeof CITIES)[number]["key"];

export const findCities = termMatcher<KnownCity>(CITIES);

/** Returns the canonical city name when the text names exactly one known city. */
export function canonicalCity(text: string): KnownCity | null {
  const found = findCities(text);
  return found.length === 1 ? (found[0] ?? null) : null;
}

const REMOTE_WORDS = new Set(["remote", "anywhere", "wfh", "work from home", "remote india"]);
export const isRemoteWord = (text: string) => REMOTE_WORDS.has(normalizeTerm(text));

export const DEGREES = [
  {
    key: "btech",
    label: "B.Tech / B.E.",
    level: "bachelor",
    aliases: ["B.Tech", "BTech", "B.E.", "BE", "Bachelor of Technology", "Bachelor of Engineering"],
  },
  { key: "bsc", label: "B.Sc", level: "bachelor", aliases: ["B.Sc", "BSc", "BS", "Bachelor of Science"] },
  {
    key: "bca",
    label: "BCA",
    level: "bachelor",
    aliases: ["BCA", "Bachelor of Computer Applications", "Bachelor of Computer Application"],
  },
  { key: "bcom", label: "B.Com", level: "bachelor", aliases: ["B.Com", "BCom", "Bachelor of Commerce"] },
  {
    key: "bba",
    label: "BBA",
    level: "bachelor",
    aliases: ["BBA", "BBM", "Bachelor of Business Administration"],
  },
  { key: "ba", label: "B.A.", level: "bachelor", aliases: ["B.A.", "BA", "Bachelor of Arts"] },
  {
    key: "mtech",
    label: "M.Tech / M.E.",
    level: "master",
    aliases: ["M.Tech", "MTech", "M.E.", "ME", "Master of Technology", "Master of Engineering"],
  },
  { key: "msc", label: "M.Sc", level: "master", aliases: ["M.Sc", "MSc", "MS", "Master of Science"] },
  {
    key: "mca",
    label: "MCA",
    level: "master",
    aliases: ["MCA", "Master of Computer Applications", "Master of Computer Application"],
  },
  { key: "mba", label: "MBA", level: "master", aliases: ["MBA", "Master of Business Administration"] },
  { key: "pgdm", label: "PGDM", level: "master", aliases: ["PGDM", "PGDBM"] },
  { key: "mcom", label: "M.Com", level: "master", aliases: ["M.Com", "MCom", "Master of Commerce"] },
  { key: "ma", label: "M.A.", level: "master", aliases: ["M.A.", "MA", "Master of Arts"] },
  { key: "diploma", label: "Diploma", level: "diploma", aliases: ["Diploma", "Polytechnic Diploma"] },
  {
    key: "phd",
    label: "PhD",
    level: "doctorate",
    aliases: ["PhD", "Ph.D.", "Doctor of Philosophy"],
  },
] as const satisfies readonly {
  key: string;
  label: string;
  level: DegreeLevel;
  aliases: readonly string[];
}[];
export type DegreeKey = (typeof DEGREES)[number]["key"];

const findDegrees = termMatcher<DegreeKey>(DEGREES);
const findLevels = termMatcher<DegreeLevel>([
  {
    key: "bachelor",
    aliases: ["Bachelor", "Bachelors", "Bachelor's", "Undergraduate", "UG", "Graduate", "Graduation"],
  },
  { key: "master", aliases: ["Master", "Masters", "Master's", "Postgraduate", "Post graduate", "PG"] },
  { key: "diploma", aliases: ["Diploma", "Polytechnic"] },
  { key: "doctorate", aliases: ["PhD", "Ph.D.", "Doctorate", "Doctoral"] },
]);
const levelRank = (level: DegreeLevel) => DEGREE_LEVELS.indexOf(level);
export const DEGREE_LEVEL_LABELS: Record<DegreeLevel, string> = {
  diploma: "diploma",
  bachelor: "bachelor's",
  master: "master's",
  doctorate: "doctoral",
};

export function compareDegreeLevels(a: DegreeLevel, b: DegreeLevel): number {
  return levelRank(a) - levelRank(b);
}

export function degreeInfo(text: string | null): { keys: DegreeKey[]; level: DegreeLevel | null } {
  if (!text) return { keys: [], level: null };
  const keys = findDegrees(text);
  const levels = [
    ...keys.map((key) => DEGREES.find((degree) => degree.key === key)?.level ?? "bachelor"),
    ...findLevels(text),
  ];
  const level = levels.sort(compareDegreeLevels).at(-1) ?? null;
  return { keys, level };
}

export const FIELDS = [
  {
    key: "computer_science",
    label: "Computer Science",
    aliases: [
      "Computer Science",
      "Computer Science and Engineering",
      "Computer Science Engineering",
      "Computer Engineering",
      "CS",
      "CSE",
      "CS&E",
      "Comp Sci",
    ],
  },
  {
    key: "information_technology",
    label: "Information Technology",
    aliases: [
      "Information Technology",
      "Information Science",
      "Information Science and Engineering",
      "IT",
      "ISE",
    ],
  },
  {
    key: "data_science_ai",
    label: "Data Science / AI",
    aliases: [
      "Data Science",
      "Artificial Intelligence",
      "Artificial Intelligence and Machine Learning",
      "Artificial Intelligence and Data Science",
      "Machine Learning",
      "AI",
      "AIML",
      "AI&ML",
      "AI&DS",
    ],
  },
  {
    key: "computer_applications",
    label: "Computer Applications",
    aliases: ["Computer Applications", "Computer Application"],
  },
  {
    key: "electronics",
    label: "Electronics & Communication",
    aliases: [
      "Electronics and Communication",
      "Electronics and Communication Engineering",
      "Electronics and Telecommunication",
      "Electronics",
      "Telecommunication",
      "ECE",
      "E&TC",
      "EXTC",
      "ENTC",
    ],
  },
  {
    key: "electrical",
    label: "Electrical & Electronics",
    aliases: [
      "Electrical",
      "Electrical Engineering",
      "Electrical and Electronics",
      "Electrical and Electronics Engineering",
      "EEE",
      "EE",
    ],
  },
  { key: "mechanical", label: "Mechanical", aliases: ["Mechanical", "Mechanical Engineering", "Mech"] },
  { key: "civil", label: "Civil", aliases: ["Civil", "Civil Engineering"] },
  { key: "chemical", label: "Chemical", aliases: ["Chemical", "Chemical Engineering"] },
  {
    key: "mathematics",
    label: "Mathematics",
    aliases: ["Mathematics", "Maths", "Math", "Applied Mathematics", "Mathematics and Computing"],
  },
  { key: "statistics", label: "Statistics", aliases: ["Statistics", "Applied Statistics", "Stats"] },
  { key: "physics", label: "Physics", aliases: ["Physics"] },
  { key: "commerce", label: "Commerce", aliases: ["Commerce", "Accounting", "Accountancy", "Finance"] },
  { key: "economics", label: "Economics", aliases: ["Economics"] },
  {
    key: "business",
    label: "Business / Management",
    aliases: ["Business Administration", "Business", "Management"],
  },
] as const satisfies readonly { key: string; label: string; aliases: readonly string[] }[];
export type FieldKey = (typeof FIELDS)[number]["key"];

export const findFields = termMatcher<FieldKey>(FIELDS);
