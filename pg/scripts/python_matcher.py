"""
Runs the OLD Python fuzzywuzzy matching logic on a JSON input file.
Input:  { rmpNames: string[], instructorNames: string[] }
Output: JSON array of { rmpName, matchedName, score } to stdout
"""
import json
import sys
import re
from fuzzywuzzy import fuzz, process


def clean_name(name):
    if not name:
        return ""
    name = re.sub(r'\s+', ' ', name.strip())
    name = re.sub(r'\s*\([^)]+\)\s*', ' ', name)
    name = re.sub(r'^(Dr\.?|Professor|Prof\.?|Mr\.?|Ms\.?|Mrs\.?)\s+', '', name, flags=re.IGNORECASE)
    name = re.sub(r'[.,]+$', '', name)
    name = re.sub(r'\s+', ' ', name).strip()
    return name


def create_name_variations(name):
    cleaned = clean_name(name)
    if not cleaned:
        return []
    variations = {cleaned}
    parts = cleaned.split()
    if len(parts) >= 2:
        first = parts[0]
        last = parts[-1]
        variations.add(f"{first} {last}")
        variations.add(f"{last}, {first}")
        if len(parts) > 2:
            middles = parts[1:-1]
            variations.add(f"{first} {' '.join(middles)} {last}")
            initials = ' '.join([p[0] + '.' for p in middles if p])
            variations.add(f"{first} {initials} {last}")
    return list(variations)


def match_all(rmp_names, instructor_names):
    instructor_set = set(clean_name(n) for n in instructor_names)
    instructor_list = [n for n in instructor_set if n]

    results = []
    for rmp_name in rmp_names:
        variations = create_name_variations(rmp_name)
        best_match = rmp_name
        best_score = 0

        for variation in variations:
            if not variation:
                continue
            if variation in instructor_set:
                best_match = variation
                best_score = 100
                break
            match = process.extractOne(
                variation,
                instructor_list,
                scorer=fuzz.token_sort_ratio,
                score_cutoff=80
            )
            if match and match[1] > best_score:
                best_match = match[0]
                best_score = match[1]
                if best_score >= 95:
                    break

        results.append({
            "rmpName": rmp_name,
            "matchedName": best_match if best_score >= 80 else rmp_name,
            "score": best_score
        })

    return results


if __name__ == "__main__":
    input_data = json.load(open(sys.argv[1]))
    results = match_all(input_data["rmpNames"], input_data["instructorNames"])
    json.dump(results, sys.stdout)
