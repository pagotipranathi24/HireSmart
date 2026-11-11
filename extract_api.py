
import sys
import json

from extract import process_resume


def main():
    results = []

    arguments = sys.argv[1:]

    if len(arguments) % 2 != 0:
        print(json.dumps({
            "success": False,
            "error": "Invalid resume file arguments."
        }))
        sys.exit(1)

    for index in range(0, len(arguments), 2):
        file_path = arguments[index]
        file_name = arguments[index + 1]

        try:
            candidate = process_resume(file_path)

            results.append({
                "success": True,
                "fileName": file_name,
                "candidate": candidate
            })

        except Exception as error:
            results.append({
                "success": False,
                "fileName": file_name,
                "error": str(error)
            })

    print(json.dumps(results, ensure_ascii=False))


if __name__ == "__main__":
    main()
