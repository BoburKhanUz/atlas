#!/usr/bin/env python3
"""Validate the project skills in .claude/skills against the Agent Skills rules.

Checks per skill folder: SKILL.md exists, frontmatter has only allowed keys,
`name` equals the folder name and is lowercase-hyphenated (<= 64 chars),
`description` is 1-1024 characters without angle brackets, SKILL.md is under
500 lines, and every `references/*.md` path it mentions exists.
Exit code 1 lists every problem found.
"""
import pathlib
import re
import sys

ALLOWED_KEYS = {"name", "description", "license", "compatibility", "metadata", "allowed-tools"}
NAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


def check(skill_dir: pathlib.Path) -> list[str]:
    problems = []
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.is_file():
        return [f"{skill_dir.name}: SKILL.md is missing"]
    text = skill_md.read_text(encoding="utf-8")
    match = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not match:
        return [f"{skill_dir.name}: SKILL.md has no frontmatter block"]
    fields = {}
    for line in match.group(1).splitlines():
        key_match = re.match(r"^([a-z-]+):\s*(.*)$", line)
        if key_match:
            fields[key_match.group(1)] = key_match.group(2).strip()
    unknown = set(fields) - ALLOWED_KEYS
    if unknown:
        problems.append(f"{skill_dir.name}: unknown frontmatter keys {sorted(unknown)}")
    name = fields.get("name", "")
    if name != skill_dir.name:
        problems.append(f"{skill_dir.name}: name '{name}' does not equal the folder name")
    if not NAME_RE.match(name) or len(name) > 64:
        problems.append(f"{skill_dir.name}: name must be lowercase letters, digits and single hyphens, at most 64 characters")
    description = fields.get("description", "")
    if not 1 <= len(description) <= 1024:
        problems.append(f"{skill_dir.name}: description must be 1-1024 characters (has {len(description)})")
    if "<" in description or ">" in description:
        problems.append(f"{skill_dir.name}: description must not contain angle brackets")
    if text.count("\n") >= 500:
        problems.append(f"{skill_dir.name}: SKILL.md has 500 or more lines; move detail to references/")
    for ref in sorted(set(re.findall(r"(?<![\w/.-])references/[\w.-]+\.md", text))):
        if not (skill_dir / ref).is_file():
            problems.append(f"{skill_dir.name}: mentions {ref}, which does not exist")
    return problems


def main() -> int:
    root = pathlib.Path(__file__).resolve().parents[2] / ".claude" / "skills"
    skills = sorted(p for p in root.iterdir() if p.is_dir())
    if not skills:
        print(f"no skills found under {root}")
        return 1
    problems = [problem for skill in skills for problem in check(skill)]
    for problem in problems:
        print(problem)
    print(f"checked {len(skills)} skills, {len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
