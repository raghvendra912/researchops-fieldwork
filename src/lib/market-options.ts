const countryCodes = "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" ");
const languageCodes = "aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu".split(" ");

// ISO 3166 market -> ISO 639-1 languages commonly used for respondent-facing
// fieldwork. The first entry is the default; later entries cover other official
// or widely spoken languages. The UI still exposes every language as a fallback.
const countryLanguageCodes: Record<string, string[]> = {
  AD:["ca","es","fr"],AE:["ar","en","hi","ur"],AF:["fa","ps","uz","tk"],AG:["en"],AI:["en"],AL:["sq"],AM:["hy","ru"],AO:["pt"],AQ:["en"],AR:["es"],AS:["sm","en"],AT:["de"],AU:["en"],AW:["nl","es","en"],AX:["sv","fi"],AZ:["az","ru"],
  BA:["bs","hr","sr"],BB:["en"],BD:["bn","en"],BE:["nl","fr","de"],BF:["fr","ff"],BG:["bg"],BH:["ar","en"],BI:["rn","fr","en"],BJ:["fr"],BL:["fr"],BM:["en"],BN:["ms","en","zh"],BO:["es","qu","ay"],BQ:["nl","en"],BR:["pt"],BS:["en"],BT:["dz","en"],BV:["no"],BW:["en","tn"],BY:["be","ru"],BZ:["en","es"],
  CA:["en","fr"],CC:["en","ms"],CD:["fr","sw","ln","kg"],CF:["fr","sg"],CG:["fr","ln"],CH:["de","fr","it","rm"],CI:["fr"],CK:["en"],CL:["es"],CM:["fr","en"],CN:["zh","ug","bo"],CO:["es"],CR:["es"],CU:["es"],CV:["pt"],CW:["nl","en","es"],CX:["en","zh","ms"],CY:["el","tr","en"],CZ:["cs"],
  DE:["de"],DJ:["fr","ar","so"],DK:["da"],DM:["en"],DO:["es"],DZ:["ar","fr"],EC:["es","qu"],EE:["et","ru"],EG:["ar","en"],EH:["ar","es"],ER:["ti","ar","en"],ES:["es","ca","eu","gl"],ET:["am","om","en"],FI:["fi","sv"],FJ:["en","fj","hi"],FK:["en"],FM:["en"],FO:["fo","da"],FR:["fr"],
  GA:["fr"],GB:["en","cy","gd"],GD:["en"],GE:["ka","ru"],GF:["fr"],GG:["en","fr"],GH:["en","ak","ee"],GI:["en","es"],GL:["kl","da"],GM:["en"],GN:["fr"],GP:["fr"],GQ:["es","fr","pt"],GR:["el"],GS:["en"],GT:["es"],GU:["en","ch"],GW:["pt"],GY:["en"],
  HK:["zh","en"],HM:["en"],HN:["es"],HR:["hr"],HT:["fr","ht"],HU:["hu"],ID:["id","jv"],IE:["en","ga"],IL:["he","ar","en"],IM:["en","gv"],IN:["hi","en","bn","te","mr","ta","ur","gu","kn","ml","pa","or","as"],IO:["en"],IQ:["ar","ku"],IR:["fa","az","ku"],IS:["is","en"],IT:["it","de","fr"],JE:["en","fr"],JM:["en"],JO:["ar","en"],JP:["ja"],
  KE:["sw","en"],KG:["ky","ru"],KH:["km"],KI:["en"],KM:["ar","fr","sw"],KN:["en"],KP:["ko"],KR:["ko"],KW:["ar","en"],KY:["en"],KZ:["kk","ru"],LA:["lo"],LB:["ar","fr","en"],LC:["en"],LI:["de"],LK:["si","ta","en"],LR:["en"],LS:["st","en"],LT:["lt","ru"],LU:["lb","fr","de"],LV:["lv","ru"],LY:["ar"],
  MA:["ar","fr"],MC:["fr"],MD:["ro","ru"],ME:["sr"],MF:["fr"],MG:["mg","fr"],MH:["en","mh"],MK:["mk","sq"],ML:["fr","bm"],MM:["my"],MN:["mn"],MO:["zh","pt"],MP:["en"],MQ:["fr"],MR:["ar","fr"],MS:["en"],MT:["mt","en"],MU:["en","fr","hi"],MV:["dv","en"],MW:["en","ny"],MX:["es"],MY:["ms","en","zh","ta"],MZ:["pt"],
  NA:["en","af","de"],NC:["fr"],NE:["fr","ha"],NF:["en"],NG:["en","ha","yo","ig"],NI:["es"],NL:["nl","fy"],NO:["no","nb","nn","se"],NP:["ne","en"],NR:["en","na"],NU:["en"],NZ:["en","mi"],OM:["ar","en"],PA:["es"],PE:["es","qu","ay"],PF:["fr"],PG:["en"],PH:["en"],PK:["ur","en","pa","sd","ps"],PL:["pl"],PM:["fr"],PN:["en"],PR:["es","en"],PS:["ar","he"],PT:["pt"],PW:["en"],PY:["es"],QA:["ar","en"],
  RE:["fr"],RO:["ro","hu"],RS:["sr"],RU:["ru"],RW:["rw","en","fr"],SA:["ar","en"],SB:["en"],SC:["en","fr"],SD:["ar","en"],SE:["sv"],SG:["en","ms","zh","ta"],SH:["en"],SI:["sl"],SJ:["no","ru"],SK:["sk"],SL:["en"],SM:["it"],SN:["fr","wo"],SO:["so","ar"],SR:["nl"],SS:["en","ar"],ST:["pt"],SV:["es"],SX:["nl","en"],SY:["ar"],SZ:["en","ss"],
  TC:["en"],TD:["fr","ar"],TF:["fr"],TG:["fr","ee"],TH:["th"],TJ:["tg","ru"],TK:["en"],TL:["pt"],TM:["tk","ru"],TN:["ar","fr"],TO:["to","en"],TR:["tr","ku"],TT:["en"],TV:["en"],TW:["zh"],TZ:["sw","en"],UA:["uk","ru"],UG:["en","sw"],UM:["en"],US:["en","es"],UY:["es"],UZ:["uz","ru"],VA:["it","la"],VC:["en"],VE:["es"],VG:["en"],VI:["en"],VN:["vi"],VU:["en","fr"],WF:["fr"],WS:["sm","en"],YE:["ar"],YT:["fr"],ZA:["en","zu","xh","af","st","tn"],ZM:["en"],ZW:["en","sn","nd"],
};

import { marketNames } from "./market-names.ts";

const countryNames = marketNames.countryCodes as Record<string, string>;
const languageNames = marketNames.languageCodes as Record<string, string>;

function stableNameOrder(a: { code: string; name: string }, b: { code: string; name: string }) {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
}

export const countryOptions = countryCodes.map((code) => ({ code, name: countryNames[code] ?? code })).sort(stableNameOrder);
export const languageOptions = languageCodes.map((code) => ({ code, name: languageNames[code] ?? code })).sort(stableNameOrder);
export const validCountryCodes = new Set(countryCodes);
export const validLanguageCodes = new Set(languageCodes);

export function languageOptionsForCountry(countryCode: string) {
  const preferred = countryLanguageCodes[countryCode.toUpperCase()] ?? ["en"];
  return preferred.map((code) => languageOptions.find((option) => option.code === code)).filter((option): option is { code: string; name: string } => Boolean(option));
}

export function countryName(code: string) {
  return countryNames[code.toUpperCase()] ?? code.toUpperCase();
}

export function languageName(code: string) {
  return languageNames[code.toLowerCase()] ?? code.toLowerCase();
}
