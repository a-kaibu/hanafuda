# Wikimedia Commons の花札 SVG（Louie Mantia ほか, CC BY-SA 4.0）を取得し、出典一覧を作る（GitHub Actions 上で実行）
import json, os, re, time, traceback, urllib.parse, urllib.request

API = "https://commons.wikimedia.org/w/api.php"
UA = {"User-Agent": "a-kaibu-hanafuda/1.0 (https://github.com/a-kaibu/hanafuda)"}
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
          "September", "October", "November", "December"]
# ゲーム内の札番号順（js/cards.js と同じ並び）
TYPES = [
    ["Hikari", "Tanzaku", "Kasu 1", "Kasu 2"],
    ["Tane", "Tanzaku", "Kasu 1", "Kasu 2"],
    ["Hikari", "Tanzaku", "Kasu 1", "Kasu 2"],
    ["Tane", "Tanzaku", "Kasu 1", "Kasu 2"],
    ["Tane", "Tanzaku", "Kasu 1", "Kasu 2"],
    ["Tane", "Tanzaku", "Kasu 1", "Kasu 2"],
    ["Tane", "Tanzaku", "Kasu 1", "Kasu 2"],
    ["Hikari", "Tane", "Kasu 1", "Kasu 2"],
    ["Tane", "Tanzaku", "Kasu 1", "Kasu 2"],
    ["Tane", "Tanzaku", "Kasu 1", "Kasu 2"],
    ["Hikari", "Tane", "Tanzaku", "Kasu"],
    ["Hikari", "Kasu 1", "Kasu 2", "Kasu 3"],
]
VARIANTS = {"alt": " Alt"}  # 伝統的な配色・黒枠版

def get(url):
    for attempt in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return r.read()
        except Exception:
            if attempt == 5:
                raise
            time.sleep(5 * (attempt + 1))

def strip(html):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", html or "")).strip()

jobs = []
for var, suffix in VARIANTS.items():
    for m, types in enumerate(TYPES):
        for k, t in enumerate(types):
            jobs.append((var, m * 4 + k, f"File:Hanafuda {MONTHS[m]} {t}{suffix}.svg"))
    jobs.append((var, "back", "File:Hanafuda card back.svg"))

credits = []
errors = []
for i in range(0, len(jobs), 40):
    chunk = jobs[i:i + 40]
    d = json.loads(get(API + "?" + urllib.parse.urlencode({
        "action": "query", "format": "json", "titles": "|".join(j[2] for j in chunk), "prop": "imageinfo",
        "iiprop": "url|extmetadata", "iiextmetadatafilter": "Artist|LicenseShortName|LicenseUrl|UsageTerms"})))
    pages = {p["title"]: p for p in d["query"]["pages"].values()}
    norm = {n["from"]: n["to"] for n in d["query"].get("normalized", [])}
    for var, cid, title in chunk:
      try:
        p = pages[norm.get(title, title)]
        ii = p["imageinfo"][0]
        md = {k: v.get("value") for k, v in ii.get("extmetadata", {}).items()}
        os.makedirs(f"assets/cards/{var}", exist_ok=True)
        open(f"assets/cards/{var}/{cid}.svg", "wb").write(get(ii["url"].split("?")[0]))
        credits.append({"card": cid, "title": p["title"],
                        "page": "https://commons.wikimedia.org/wiki/" + urllib.parse.quote(p["title"].replace(" ", "_")),
                        "artist": strip(md.get("Artist")), "license": md.get("LicenseShortName"),
                        "licenseUrl": md.get("LicenseUrl")})
        time.sleep(0.5)
      except Exception:
        errors.append(title + "\n" + traceback.format_exc())
json.dump(credits, open("assets/cards/credits.json", "w"), ensure_ascii=False, indent=1)
if errors:
    raise SystemExit("\n".join(errors))
print(len(credits), len(errors))
