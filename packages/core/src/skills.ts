import { normalizeTerm, termMatcher } from "./terms";

/**
 * Canonical skills with common spellings. Unlisted skills still match by their normalized
 * text, so this list only needs the spellings that differ ("JS" and "JavaScript").
 */
const SKILLS = [
  { key: "javascript", label: "JavaScript", aliases: ["JavaScript", "JS", "ECMAScript", "ES6"] },
  { key: "typescript", label: "TypeScript", aliases: ["TypeScript", "TS"] },
  { key: "python", label: "Python", aliases: ["Python", "Python3", "Python 3"] },
  { key: "java", label: "Java", aliases: ["Java", "Core Java", "Java 8", "Java 17"] },
  { key: "go", label: "Go", aliases: ["Golang", "Go lang", "Go language"] },
  { key: "cpp", label: "C++", aliases: ["cpp", "C plus plus"] },
  { key: "csharp", label: "C#", aliases: ["csharp", "C sharp"] },
  { key: "dotnet", label: ".NET", aliases: ["dotnet", "ASP NET", "ASP NET Core", "NET Core"] },
  { key: "kotlin", label: "Kotlin", aliases: ["Kotlin"] },
  { key: "rust", label: "Rust", aliases: ["Rust"] },
  { key: "php", label: "PHP", aliases: ["PHP"] },
  { key: "ruby", label: "Ruby", aliases: ["Ruby"] },
  { key: "rails", label: "Ruby on Rails", aliases: ["Ruby on Rails", "Rails", "RoR"] },
  { key: "nodejs", label: "Node.js", aliases: ["Node js", "NodeJS", "Node"] },
  { key: "express", label: "Express", aliases: ["Express", "Express js", "ExpressJS"] },
  { key: "nestjs", label: "NestJS", aliases: ["NestJS", "Nest js"] },
  { key: "spring", label: "Spring Boot", aliases: ["Spring Boot", "SpringBoot", "Spring"] },
  { key: "django", label: "Django", aliases: ["Django"] },
  { key: "flask", label: "Flask", aliases: ["Flask"] },
  { key: "fastapi", label: "FastAPI", aliases: ["FastAPI", "Fast API"] },
  { key: "react", label: "React", aliases: ["React", "React js", "ReactJS"] },
  { key: "nextjs", label: "Next.js", aliases: ["Next js", "NextJS"] },
  { key: "angular", label: "Angular", aliases: ["Angular", "AngularJS", "Angular js"] },
  { key: "vue", label: "Vue", aliases: ["Vue", "Vue js", "VueJS"] },
  { key: "redux", label: "Redux", aliases: ["Redux", "Redux Toolkit"] },
  { key: "html", label: "HTML", aliases: ["HTML", "HTML5"] },
  { key: "css", label: "CSS", aliases: ["CSS", "CSS3"] },
  { key: "tailwind", label: "Tailwind CSS", aliases: ["Tailwind", "Tailwind CSS", "TailwindCSS"] },
  { key: "sass", label: "Sass", aliases: ["Sass", "SCSS"] },
  { key: "webpack", label: "Webpack", aliases: ["Webpack"] },
  { key: "accessibility", label: "Web accessibility", aliases: ["accessibility", "a11y", "WCAG"] },
  { key: "sql", label: "SQL", aliases: ["SQL"] },
  { key: "postgresql", label: "PostgreSQL", aliases: ["PostgreSQL", "Postgres", "PSQL"] },
  { key: "mysql", label: "MySQL", aliases: ["MySQL"] },
  { key: "mongodb", label: "MongoDB", aliases: ["MongoDB", "Mongo"] },
  { key: "redis", label: "Redis", aliases: ["Redis"] },
  { key: "kafka", label: "Kafka", aliases: ["Kafka", "Apache Kafka"] },
  { key: "rabbitmq", label: "RabbitMQ", aliases: ["RabbitMQ"] },
  { key: "elasticsearch", label: "Elasticsearch", aliases: ["Elasticsearch", "Elastic Search"] },
  { key: "rest", label: "REST APIs", aliases: ["REST", "RESTful", "REST API", "REST APIs", "RESTful APIs"] },
  { key: "graphql", label: "GraphQL", aliases: ["GraphQL"] },
  { key: "grpc", label: "gRPC", aliases: ["gRPC"] },
  { key: "microservices", label: "Microservices", aliases: ["Microservices", "Microservice"] },
  { key: "docker", label: "Docker", aliases: ["Docker", "containers", "containerization"] },
  { key: "kubernetes", label: "Kubernetes", aliases: ["Kubernetes", "K8s"] },
  { key: "aws", label: "AWS", aliases: ["AWS", "Amazon Web Services"] },
  { key: "gcp", label: "Google Cloud", aliases: ["GCP", "Google Cloud", "Google Cloud Platform"] },
  { key: "azure", label: "Azure", aliases: ["Azure", "Microsoft Azure"] },
  { key: "git", label: "Git", aliases: ["Git", "GitHub", "GitLab", "version control"] },
  { key: "linux", label: "Linux", aliases: ["Linux", "Unix"] },
  { key: "cicd", label: "CI/CD", aliases: ["CI CD", "CICD", "continuous integration"] },
  {
    key: "testing",
    label: "Automated testing",
    aliases: ["unit testing", "unit tests", "automated testing"],
  },
  { key: "jest", label: "Jest", aliases: ["Jest"] },
  {
    key: "dsa",
    label: "Data structures and algorithms",
    aliases: ["DSA", "data structures and algorithms", "data structures", "algorithms"],
  },
  {
    key: "oop",
    label: "Object-oriented programming",
    aliases: ["OOP", "OOPS", "object oriented programming"],
  },
  {
    key: "excel",
    label: "Excel",
    aliases: ["Excel", "MS Excel", "Microsoft Excel", "Advanced Excel", "spreadsheets"],
  },
  { key: "powerbi", label: "Power BI", aliases: ["Power BI", "PowerBI"] },
  { key: "tableau", label: "Tableau", aliases: ["Tableau"] },
  { key: "looker", label: "Looker", aliases: ["Looker", "Looker Studio", "Google Data Studio"] },
  { key: "pandas", label: "pandas", aliases: ["pandas"] },
  { key: "numpy", label: "NumPy", aliases: ["NumPy"] },
  { key: "r", label: "R", aliases: ["R programming", "R language", "RStudio"] },
  {
    key: "statistics",
    label: "Statistics",
    aliases: ["statistics", "statistical analysis", "hypothesis testing", "A/B testing", "A B testing"],
  },
  {
    key: "data_visualization",
    label: "Data visualization",
    aliases: ["data visualization", "data visualisation", "dashboards", "dashboarding"],
  },
  {
    key: "machine_learning",
    label: "Machine learning",
    aliases: ["machine learning", "ML", "scikit learn", "sklearn"],
  },
  { key: "etl", label: "ETL", aliases: ["ETL", "ELT", "data pipelines"] },
  { key: "google_analytics", label: "Google Analytics", aliases: ["Google Analytics", "GA4"] },
] as const;

export type SkillKey = (typeof SKILLS)[number]["key"];

const SYMBOL_SKILLS: [RegExp, string][] = [
  [/(^|[^\p{L}\p{N}])c\s*\+\+(?=$|[^\p{L}\p{N}+])/giu, "$1 cpp "],
  [/(^|[^\p{L}\p{N}])c\s*#(?=$|[^\p{L}\p{N}#])/giu, "$1 csharp "],
  [/(^|[^\p{L}\p{N}.])\.net(?=$|[^\p{L}\p{N}])/giu, "$1 dotnet "],
];

/** Like `normalizeTerm`, but keeps C++, C#, and .NET distinct from C and "net". */
export function normalizeSkillText(text: string): string {
  let result = text;
  for (const [pattern, replacement] of SYMBOL_SKILLS) result = result.replace(pattern, replacement);
  return normalizeTerm(result);
}

const matchKnownSkills = termMatcher<SkillKey>(SKILLS);
const LABELS = new Map<string, string>(SKILLS.map((skill) => [skill.key, skill.label]));

/** Every known skill mentioned in `text`. */
export function findSkills(text: string): SkillKey[] {
  return matchKnownSkills(normalizeSkillText(text));
}

/**
 * A stable comparison key for one skill name: the canonical key when the whole name is a known
 * skill ("ReactJS" → "react"), otherwise the normalized text ("Apache Spark" → "apache spark").
 */
export function skillKey(name: string): string {
  const normalized = normalizeSkillText(name);
  const found = matchKnownSkills(normalized);
  if (found.length === 1) {
    const [key] = found;
    const skill = SKILLS.find((entry) => entry.key === key);
    if (skill?.aliases.some((alias) => normalizeSkillText(alias) === normalized) || key === normalized) {
      return key as string;
    }
  }
  return normalized;
}

export function skillLabel(key: string, fallback: string): string {
  return LABELS.get(key) ?? fallback;
}

/** True when `text` mentions the skill, matching whole words and known spellings. */
export function mentionsSkill(text: string, key: string): boolean {
  if (!key) return false;
  if (LABELS.has(key)) return findSkills(text).includes(key as SkillKey);
  return ` ${normalizeSkillText(text)} `.includes(` ${key} `);
}
