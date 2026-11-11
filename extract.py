
import re
from pathlib import Path

from pypdf import PdfReader
from docx import Document


SKILL_LIST = [
    "Python", "Java", "JavaScript", "TypeScript", "C", "C++", "C#",
    "HTML", "CSS", "React", "Angular", "Node.js", "Express",
    "SQL", "MySQL", "PostgreSQL", "MongoDB",
    "Machine Learning", "Deep Learning", "Artificial Intelligence",
    "Data Science", "Data Analysis", "Pandas", "NumPy",
    "TensorFlow", "PyTorch", "Scikit-learn",
    "Flask", "Django", "FastAPI",
    "Git", "GitHub", "Docker", "AWS", "Azure",
    "Communication", "Leadership", "Problem Solving",
    "Data Structures", "Algorithms", "Operating Systems",
    "DBMS", "Computer Networks", "Power BI", "Excel"
]

SECTION_HEADINGS = {
    "education": [
        "education", "educational qualification",
        "academic qualification", "academic background"
    ],
    "experience": [
        "experience", "work experience",
        "professional experience", "employment history",
        "internship", "internships"
    ],
    "projects": [
        "projects", "personal projects",
        "academic projects", "project experience"
    ],
    "skills": [
        "skills", "technical skills",
        "key skills", "technical expertise"
    ]
}


def extract_pdf(file_path):
    reader = PdfReader(file_path)
    pages = []

    for page in reader.pages:
        pages.append(page.extract_text() or "")

    return "\n".join(pages)


def extract_docx(file_path):
    document = Document(file_path)

    paragraphs = [
        paragraph.text
        for paragraph in document.paragraphs
        if paragraph.text.strip()
    ]

    for table in document.tables:
        for row in table.rows:
            paragraphs.append(
                " ".join(cell.text for cell in row.cells)
            )

    return "\n".join(paragraphs)


def extract_txt(file_path):
    for encoding in ["utf-8", "utf-16", "latin-1"]:
        try:
            return Path(file_path).read_text(encoding=encoding)
        except UnicodeError:
            continue

    return Path(file_path).read_text(errors="ignore")


def extract_resume(file_path):
    extension = Path(file_path).suffix.lower()

    if extension == ".pdf":
        return extract_pdf(file_path)

    if extension == ".docx":
        return extract_docx(file_path)

    if extension == ".txt":
        return extract_txt(file_path)

    if extension == ".doc":
        raise ValueError(
            "Old .doc files are not supported. Please convert to PDF or DOCX."
        )

    raise ValueError("Unsupported resume format.")


def clean_text(text):
    text = text.replace("\x00", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n", text)
    return text.strip()


def extract_email(text):
    match = re.search(
        r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b",
        text
    )

    return match.group(0) if match else "Not found"


def extract_phone(text):
    patterns = [
        r"(?<!\d)(?:\+91[\s-]?)?[6-9]\d{9}(?!\d)",
        r"(?<!\d)\+?\d[\d\s().-]{8,16}\d(?!\d)"
    ]

    for pattern in patterns:
        match = re.search(pattern, text)

        if match:
            number = match.group(0).strip()

            if len(re.sub(r"\D", "", number)) >= 10:
                return number

    return "Not found"


def is_possible_name(line):
    line = line.strip()

    if not line or len(line) > 65:
        return False

    if re.search(r"@|https?://|www\.|\d", line):
        return False

    ignored = [
        "resume", "curriculum vitae", "profile",
        "professional summary", "career objective",
        "objective", "portfolio", "linkedin",
        "github", "education", "experience",
        "projects", "skills", "certificates",
        "technical skills", "contact"
    ]

    lowered = line.lower().strip(" :-")

    if lowered in ignored:
        return False

    if any(word in lowered for word in [
        "university", "college", "school",
        "developer", "engineer", "student",
        "application", "research", "report"
    ]):
        return False

    words = line.split()

    if len(words) < 2 or len(words) > 5:
        return False

    if not all(
        re.match(r"^[A-Za-z][A-Za-z'.-]*$", word)
        for word in words
    ):
        return False

    return True


def extract_name(text):
    lines = [
        line.strip()
        for line in text.splitlines()
        if line.strip()
    ]

    # Check the first lines, where resume names usually appear
    for line in lines[:12]:
        if is_possible_name(line):
            return line.title()

    return "Not found"


def find_section(text, section_name):
    lines = text.splitlines()
    headings = SECTION_HEADINGS[section_name]

    collecting = False
    collected = []

    all_headings = [
        heading
        for group in SECTION_HEADINGS.values()
        for heading in group
    ]

    for line in lines:
        stripped = line.strip()
        normalized = re.sub(
            r"[^a-z ]", "", stripped.lower()
        ).strip()

        if not stripped:
            continue

        if normalized in headings:
            collecting = True
            continue

        if collecting:
            if normalized in all_headings:
                break

            collected.append(stripped)

    return "\n".join(collected).strip()


def extract_skills(text):
    found = []

    for skill in SKILL_LIST:
        pattern = (
            r"(?<![a-zA-Z0-9])" +
            re.escape(skill) +
            r"(?![a-zA-Z0-9])"
        )

        if re.search(pattern, text, re.IGNORECASE):
            found.append(skill)

    return found


def extract_candidate_details(text):
    text = clean_text(text)

    education = find_section(text, "education")
    experience = find_section(text, "experience")
    projects = find_section(text, "projects")

    return {
        "name": extract_name(text),
        "email": extract_email(text),
        "phone": extract_phone(text),
        "skills": extract_skills(text),
        "education": education[:5000] if education else "Not found",
        "experience": experience[:5000] if experience else "Not found",
        "projects": projects[:5000] if projects else "Not found"
    }


def process_resume(file_path):
    raw_text = extract_resume(file_path)
    details = extract_candidate_details(raw_text)

    if not raw_text.strip():
        raise ValueError(
            "No readable text found. The PDF may be scanned or image-based."
        )

    return details
