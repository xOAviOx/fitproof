import { emptyProfile, type ProfileContent } from "@repo/core";
import { strToU8, zipSync } from "fflate";

export const FIXTURE_LINES = [
  "Synthetic Candidate",
  "synthetic@example.test | +91 9876543210",
  "https://github.com/synthetic-candidate",
  "Skills",
  "TypeScript, SQL",
  "Experience",
  "Example Labs - Backend Intern",
  "Built a REST API with TypeScript and SQL.",
  "Projects",
  "Campus Planner",
  "Built a student planner with TypeScript and SQL.",
  "Education",
  "Example Institute - BTech Computer Science",
  "2022 - 2026",
  "Certifications",
  "SQL Foundations - Example Academy",
];
export const FIXTURE_TEXT = FIXTURE_LINES.join("\n");

export function fixtureProfile(text = FIXTURE_TEXT): ProfileContent {
  const content = emptyProfile();
  content.skills = ["TypeScript", "SQL"].map((name) => ({
    name,
    tier: "internship",
    userConfirmed: false,
    sourceText: "Built a REST API with TypeScript and SQL.",
  }));
  content.experiences = [
    {
      company: "Example Labs",
      title: "Backend Intern",
      tier: "internship",
      location: null,
      startDate: null,
      endDate: null,
      isCurrent: false,
      bullets: ["Built a REST API with TypeScript and SQL."],
      skills: ["TypeScript", "SQL"],
      sourceText: "Example Labs - Backend Intern\nBuilt a REST API with TypeScript and SQL.",
      userConfirmed: false,
    },
  ];
  content.projects = [
    {
      name: "Campus Planner",
      description: null,
      url: null,
      bullets: ["Built a student planner with TypeScript and SQL."],
      skills: ["TypeScript", "SQL"],
      sourceText: "Campus Planner\nBuilt a student planner with TypeScript and SQL.",
      userConfirmed: false,
    },
  ];
  content.education = [
    {
      institution: "Example Institute",
      degree: "BTech",
      branch: "Computer Science",
      startYear: 2022,
      graduationYear: 2026,
      scoreType: null,
      score: null,
      scoreScale: null,
      coursework: [],
      sourceText: "Example Institute - BTech Computer Science\n2022 - 2026",
      userConfirmed: false,
    },
  ];
  content.certifications = [
    {
      name: "SQL Foundations",
      issuer: "Example Academy",
      issuedOn: null,
      skills: ["SQL"],
      sourceText: "SQL Foundations - Example Academy",
      userConfirmed: false,
    },
  ];
  if (text.includes("Python")) {
    content.skills = [{ name: "Python", tier: "self_declared", sourceText: "Python", userConfirmed: false }];
  }
  return content;
}

/** Small standards-compliant text PDF, generated locally so fixtures contain no real personal data. */
export function fixturePdf(lines = FIXTURE_LINES, columns = false): Uint8Array {
  const commands = lines
    .map((line, index) => {
      const escaped = line.replace(/[\\()]/g, "\\$&");
      const left = !columns || index < 6;
      const x = left ? 40 : 310;
      const y = 760 - (left ? index : index - 6) * 22;
      return `BT /F1 9 Tf 1 0 0 1 ${x} ${y} Tm (${escaped}) Tj ET`;
    })
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(commands)} >>\nstream\n${commands}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Uint8Array(Buffer.from(pdf));
}

export function fixtureDocx(lines = FIXTURE_LINES): Uint8Array {
  const xml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paragraph = (value: string) => `<w:p><w:r><w:t>${xml(value)}</w:t></w:r></w:p>`;
  return zipSync({
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    "_rels/.rels": strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
    "word/document.xml": strToU8(
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${lines.slice(0, 3).map(paragraph).join("")}<w:tbl><w:tr><w:tc>${lines.slice(3, 8).map(paragraph).join("")}</w:tc><w:tc>${lines.slice(8).map(paragraph).join("")}</w:tc></w:tr></w:tbl></w:body></w:document>`,
    ),
  });
}
