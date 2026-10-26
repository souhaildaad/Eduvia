import json
import sys
import unicodedata

STOP_WORDS = {
    "ainsi",
    "alors",
    "apres",
    "avec",
    "avoir",
    "bonne",
    "cela",
    "celle",
    "celles",
    "celui",
    "ceux",
    "chapitre",
    "comment",
    "correcte",
    "cours",
    "dans",
    "des",
    "donc",
    "elle",
    "elles",
    "entre",
    "etre",
    "etudier",
    "etudiant",
    "faire",
    "fois",
    "from",
    "into",
    "leur",
    "leurs",
    "mais",
    "meme",
    "notre",
    "nous",
    "pour",
    "plus",
    "partie",
    "quel",
    "quelle",
    "quelles",
    "quels",
    "question",
    "quiz",
    "reponse",
    "sans",
    "sera",
    "sont",
    "sous",
    "that",
    "the",
    "this",
    "tous",
    "tout",
    "tres",
    "une",
    "votre",
    "vous",
    "when",
    "where",
    "which",
    "your",
}


def normalize_text(value: str) -> str:
    text = str(value or "").strip().lower()
    text = unicodedata.normalize("NFD", text)
    return "".join(ch for ch in text if unicodedata.category(ch) != "Mn")


def tokenize(value: str):
    normalized = normalize_text(value)
    tokens = []
    current = []

    for char in normalized:
        if char.isalnum():
            current.append(char)
        else:
            if current:
                token = "".join(current)
                if len(token) >= 3 and token not in STOP_WORDS:
                    tokens.append(token)
                current = []

    if current:
        token = "".join(current)
        if len(token) >= 3 and token not in STOP_WORDS:
            tokens.append(token)

    return list(dict.fromkeys(tokens))


def title_case(value: str) -> str:
    cleaned = str(value or "").strip()
    return cleaned[:1].upper() + cleaned[1:] if cleaned else ""


def normalize_content_type(value: str) -> str:
    normalized = normalize_text(value)
    if "quiz" in normalized:
        return "quiz"
    if "video" in normalized or "mp4" in normalized or "youtube" in normalized:
        return "video"
    if "document" in normalized or "pdf" in normalized or "doc" in normalized:
        return "document"
    return normalized


def build_area_label(keywords, chapter_id, course_id):
    keyword_label = ", ".join(title_case(keyword) for keyword in keywords[:3])
    if keyword_label:
        return keyword_label
    if chapter_id:
        return f"Chapitre {chapter_id}"
    if course_id:
        return f"Cours {course_id}"
    return "Notion a renforcer"


def build_area_reason(label, chapter_id, course_id):
    lowered = label.lower()
    if chapter_id and course_id:
        return f"Des erreurs reviennent sur {lowered} dans {chapter_id} du cours {course_id}."
    if chapter_id:
        return f"Des erreurs reviennent sur {lowered} dans {chapter_id}."
    if course_id:
        return f"Des erreurs reviennent sur {lowered} dans le cours {course_id}."
    return f"Des erreurs reviennent sur {lowered}."


def severity_label(severity: int) -> str:
    if severity >= 80:
        return "Priorite haute"
    if severity >= 50:
        return "A renforcer"
    return "A surveiller"


def build_recommendation_reason(
    normalized_type,
    weak_area_label,
    chapter_id,
    course_id,
    is_retry_quiz=False,
):
    if normalized_type == "quiz":
        action = (
            "Quiz conseille a refaire pour verifier"
            if is_retry_quiz
            else "Quiz conseille pour verifier"
        )
    elif normalized_type == "video":
        action = "Video conseillee pour revoir"
    else:
        action = "Document conseille pour renforcer"

    if chapter_id:
        location = f" dans {chapter_id}"
    elif course_id:
        location = f" dans le cours {course_id}"
    else:
        location = ""

    return f"{action} {weak_area_label.lower()}{location}."


def is_recommendable_content(content):
    normalized_type = normalize_content_type(content.get("type"))
    if normalized_type == "quiz":
        return int(content.get("quizQuestionCount") or 0) > 0
    if normalized_type in {"document", "video"}:
        return bool(
            str(
                content.get("fileUrl")
                or content.get("source")
                or content.get("fileName")
                or ""
            ).strip()
        )
    return False


def build_weak_acquis(attempts):
    areas = {}

    for attempt in attempts:
        for question in attempt.get("questionAttempts") or []:
            course_id = str(question.get("courseId") or attempt.get("courseId") or "").strip()
            chapter_id = str(question.get("chapterId") or attempt.get("chapterId") or "").strip()
            keywords = tokenize(
                " ".join(
                    part
                    for part in [
                        question.get("prompt"),
                        question.get("explanation"),
                        chapter_id,
                        course_id,
                    ]
                    if part
                )
            )
            keyword_key = "-".join(keywords[:2]) or "notion"
            area_key = "||".join(
                part
                for part in [
                    normalize_text(chapter_id),
                    normalize_text(course_id),
                    keyword_key,
                ]
                if part
            ) or f"{attempt.get('quizId')}||{question.get('questionId')}"

            if area_key not in areas:
                areas[area_key] = {
                    "key": area_key,
                    "label": build_area_label(keywords, chapter_id, course_id),
                    "courseId": course_id or None,
                    "chapterId": chapter_id or None,
                    "keywords": [],
                    "incorrectQuestions": 0,
                    "totalQuestions": 0,
                }

            area = areas[area_key]
            area["totalQuestions"] += 1
            if not question.get("isCorrect"):
                area["incorrectQuestions"] += 1

            for keyword in keywords[:6]:
                if keyword not in area["keywords"]:
                    area["keywords"].append(keyword)

    weak_acquis = []
    for area in areas.values():
        if area["incorrectQuestions"] <= 0:
            continue
        severity = round((area["incorrectQuestions"] / max(1, area["totalQuestions"])) * 100)
        weak_acquis.append(
            {
                "key": area["key"],
                "label": area["label"],
                "severity": severity,
                "severityLabel": severity_label(severity),
                "incorrectQuestions": area["incorrectQuestions"],
                "totalQuestions": area["totalQuestions"],
                "successRate": max(0, 100 - severity),
                "keywords": area["keywords"][:6],
                "courseId": area["courseId"],
                "chapterId": area["chapterId"],
                "reason": build_area_reason(area["label"], area["chapterId"], area["courseId"]),
            }
        )

    weak_acquis.sort(
        key=lambda item: (item["severity"], item["incorrectQuestions"]),
        reverse=True,
    )
    return weak_acquis[:6]


def build_recommendations(attempts, weak_acquis, contents, max_recommendations):
    attempted_quiz_ids = {
        str(attempt.get("quizId") or "").strip() for attempt in attempts if attempt.get("quizId")
    }
    ranked = []

    for content in contents:
        if not is_recommendable_content(content):
            continue

        normalized_type = normalize_content_type(content.get("type"))
        is_attempted_quiz = (
            normalized_type == "quiz"
            and str(content.get("contentId") or "").strip() in attempted_quiz_ids
        )

        content_tokens = set(
            tokenize(
                " ".join(
                    part
                    for part in [
                        content.get("title"),
                        content.get("description"),
                        content.get("courseId"),
                        content.get("chapterId"),
                        content.get("partId"),
                        content.get("fileName"),
                        content.get("source"),
                    ]
                    if part
                )
            )
        )

        best_area = None
        best_score = 0

        for area in weak_acquis:
            score = 0

            if normalize_text(content.get("courseId")) and normalize_text(
                content.get("courseId")
            ) == normalize_text(area.get("courseId")):
                score += 10

            if normalize_text(content.get("chapterId")) and normalize_text(
                content.get("chapterId")
            ) == normalize_text(area.get("chapterId")):
                score += 14

            overlap_count = len(
                [keyword for keyword in area.get("keywords", []) if keyword in content_tokens]
            )
            score += overlap_count * 4
            score += round((area.get("severity") or 0) / 25)

            if normalized_type == "quiz":
                score += 5
            elif normalized_type == "document":
                score += 3
            elif normalized_type == "video":
                score += 2

            if score > best_score:
                best_score = score
                best_area = area

        if best_area and best_score >= 8:
            ranked.append(
                {
                    "contentId": content.get("contentId"),
                    "type": content.get("type"),
                    "score": best_score,
                    "normalizedType": normalized_type,
                    "isAttemptedQuiz": is_attempted_quiz,
                    "reason": build_recommendation_reason(
                        normalized_type,
                        best_area.get("label") or "les notions fragiles",
                        content.get("chapterId"),
                        content.get("courseId"),
                        is_attempted_quiz,
                    ),
                    "focusLabels": [best_area.get("label")] if best_area.get("label") else [],
                    "courseId": content.get("courseId"),
                    "chapterId": content.get("chapterId"),
                }
            )

    ranked.sort(
        key=lambda item: (item.get("isAttemptedQuiz", False), -(item.get("score") or 0)),
    )

    selected = [item for item in ranked if not item.get("isAttemptedQuiz")][:max_recommendations]

    if not any(item.get("normalizedType") == "quiz" for item in selected):
        fallback_quiz = next(
            (item for item in ranked if item.get("normalizedType") == "quiz"),
            None,
        )
        if fallback_quiz:
            selected.insert(0, fallback_quiz)

    deduped = []
    seen_content_ids = set()
    for item in selected:
        content_id = str(item.get("contentId") or "").strip()
        if not content_id or content_id in seen_content_ids:
            continue
        seen_content_ids.add(content_id)
        deduped.append(item)
        if len(deduped) >= max_recommendations:
            break

    return deduped


def main():
    raw_payload = sys.stdin.read()
    payload = json.loads(raw_payload or "{}")
    attempts = sorted(
        payload.get("attempts") or [],
        key=lambda item: item.get("submittedAt") or "",
        reverse=True,
    )
    contents = payload.get("contents") or []
    weak_acquis = build_weak_acquis(attempts)
    recommendations = (
        build_recommendations(
            attempts,
            weak_acquis,
            contents,
            int(payload.get("maxRecommendations") or 8),
        )
        if weak_acquis
        else []
    )
    last_attempt = attempts[0] if attempts else {}
    average_score = (
        round(sum(float(attempt.get("score") or 0) for attempt in attempts) / len(attempts))
        if attempts
        else 0
    )

    result = {
        "weakAcquis": weak_acquis,
        "recommendations": recommendations,
        "summary": {
            "attemptsAnalyzed": len(attempts),
            "averageScore": average_score,
            "lastScore": round(float(last_attempt.get("score") or 0)),
            "lastQuizTitle": last_attempt.get("quizTitle") or "",
            "weakAcquisCount": len(weak_acquis),
            "recommendationCount": len(recommendations),
        },
    }
    sys.stdout.write(json.dumps(result))


if __name__ == "__main__":
    main()
