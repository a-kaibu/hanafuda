# Wikimedia Commons から花札の画像候補とライセンス情報を集める（GitHub Actions 上で実行）
import json, os, traceback, urllib.parse, urllib.request
os.makedirs('assets/cards', exist_ok=True)

API = "https://commons.wikimedia.org/w/api.php"
UA = {"User-Agent": "a-kaibu-hanafuda/1.0 (https://github.com/a-kaibu/hanafuda)"}

out = {"categories": {}, "search": [], "meta": {}, "errors": []}

def q(params):
    url = API + "?" + urllib.parse.urlencode({**params, "format": "json"})
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
            return json.load(r)
    except Exception:
        out["errors"].append(url + "\n" + traceback.format_exc())
        return {}

titles = set()
for cat in ["Category:SVG Hanafuda", "Category:Hanafuda", "Category:Hanafuda cards", "Category:Hachi-hachi hanafuda"]:
    d = q({"action": "query", "list": "categorymembers", "cmtitle": cat, "cmlimit": "500"})
    members = [m["title"] for m in d.get("query", {}).get("categorymembers", [])]
    out["categories"][cat] = members
    titles.update(t for t in members if t.startswith("File:"))
for term in ["hanafuda svg", "hanafuda", "花札"]:
    d = q({"action": "query", "list": "search", "srsearch": term, "srnamespace": "6", "srlimit": "500"})
    res = [s["title"] for s in d.get("query", {}).get("search", [])]
    out["search"] += res
    titles.update(res)
titles = sorted(titles)
for i in range(0, len(titles), 40):
    d = q({"action": "query", "titles": "|".join(titles[i:i + 40]), "prop": "imageinfo",
           "iiprop": "url|size|mime|extmetadata", "iiextmetadatafilter": "Artist|LicenseShortName|License|UsageTerms|AttributionRequired|Credit"})
    for p in d.get("query", {}).get("pages", {}).values():
        ii = (p.get("imageinfo") or [{}])[0]
        md = {k: v.get("value") for k, v in (ii.get("extmetadata") or {}).items()}
        out["meta"][p["title"]] = {"url": ii.get("url"), "mime": ii.get("mime"), "w": ii.get("width"), "h": ii.get("height"), **md}
json.dump(out, open("assets/cards/_discovery.json", "w"), ensure_ascii=False, indent=1)
print(len(titles), "files")
