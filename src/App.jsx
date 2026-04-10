import React, { useEffect, useMemo, useState } from "react";

const MODEL_ID = "gemma-3-27b-it";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:generateContent`;
const STORAGE_KEY = "google_ai_api_key_cormach_v6";

const initialForm = {
  tipo_attivita: "",
  business_prevalente: "",
  tipologie_veicoli: [],
  volume_veicoli_giorno: "",
  volume_gomme_giorno: "",
  servizi_richiesti: [],
  specializzazioni: [],
  spazio_officina: "",
  pavimentazione: "",
  livello_operatore: "",
  priorita_cliente: "",
  auto_monitor_pref: "",
  auto_lock_pref: "",
  truck_smonto_fascia: "",
  truck_eq_level: "",
  richiede_leverless: false,
  richiede_assetto: false,
  richiede_gabbia_gonfiaggio: false,
  note_cliente: ""
};

function cleanJsonResponse(text) {
  let cleaned = String(text || "").trim();
  if (cleaned.startsWith("```json")) cleaned = cleaned.replace(/^```json\s*/i, "");
  if (cleaned.startsWith("```")) cleaned = cleaned.replace(/^```\s*/i, "");
  if (cleaned.endsWith("```")) cleaned = cleaned.replace(/\s*```$/, "");
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  return cleaned.trim();
}

function exportCommercialText(result) {
  const p = result?.profilo_officina || {};
  const lines = [];
  lines.push("CONFIGURAZIONE CORMACH");
  lines.push("");
  lines.push(`Profilo: ${p.sintesi || "-"}`);
  lines.push(`Classe volume: ${p.classe_volume || "-"}`);
  lines.push("");

  const pushLine = (sectionTitle, line, isTruck = false) => {
    if (!line?.attiva) return;
    lines.push(sectionTitle.toUpperCase());
    [["Base", line.base], ["Consigliata", line.consigliata], ["Premium", line.premium]].forEach(([label, item]) => {
      lines.push(`${label}:`);
      lines.push(`- Smontagomme: ${item?.smontagomme?.model || "-"}${item?.smontagomme?.code ? ` (${item.smontagomme.code})` : ""}`);
      lines.push(`  Descrizione CSV: ${item?.smontagomme?.csv_description || "-"}`);
      lines.push(`  Dettagli: ${(item?.smontagomme?.details || []).join(", ") || "-"}`);
      lines.push(`  Differenze: ${item?.smontagomme?.difference || "-"}`);
      lines.push(`- Equilibratrice: ${item?.equilibratrice?.model || "-"}${item?.equilibratrice?.code ? ` (${item.equilibratrice.code})` : ""}`);
      lines.push(`  Descrizione CSV: ${item?.equilibratrice?.csv_description || "-"}`);
      lines.push(`  Dettagli: ${(item?.equilibratrice?.details || []).join(", ") || "-"}`);
      lines.push(`  Differenze: ${item?.equilibratrice?.difference || "-"}`);
      if (isTruck) {
        lines.push(`- Gabbia gonfiaggio: ${item?.gabbia_gonfiaggio?.model || (item?.gabbia_gonfiaggio?.necessaria ? "Necessaria" : "Non necessaria")}`);
      }
      if ((item?.accessori || []).length) {
        lines.push(`- Accessori: ${(item.accessori || []).map(a => `${a.name}${a.code ? ` (${a.code})` : ""}`).join(", ")}`);
      }
      lines.push("");
    });
  };

  pushLine("Linea auto", result?.linea_auto, false);
  pushLine("Linea truck", result?.linea_truck, true);

  if ((result?.domande_successive || []).length) {
    lines.push("Domande successive:");
    result.domande_successive.forEach(d => lines.push(`- ${d}`));
  }
  return lines.join("\n");
}

export default function App() {
  const [step, setStep] = useState(1);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [savedApiKey, setSavedApiKey] = useState("");
  const [catalogo, setCatalogo] = useState(null);
  const [catalogoError, setCatalogoError] = useState("");
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [rawJson, setRawJson] = useState("");
  const [error, setError] = useState("");
  const [showTechnical, setShowTechnical] = useState(false);

  useEffect(() => {
    setSavedApiKey(localStorage.getItem(STORAGE_KEY) || "");
  }, []);

  useEffect(() => {
    const loadCatalogo = async () => {
      try {
        const res = await fetch("/catalogo-prodotti-cormach-v6.csv-aligned.json", { cache: "no-store" });
        if (!res.ok) throw new Error("Impossibile caricare il catalogo.");
        setCatalogo(await res.json());
      } catch (err) {
        console.error(err);
        setCatalogoError("Errore caricamento catalogo.");
      }
    };
    loadCatalogo();
  }, []);

  const progress = useMemo(() => Math.round((step / 8) * 100), [step]);
  const lineTruckActive = form.tipologie_veicoli.includes("truck") || form.tipologie_veicoli.includes("heavy_duty");
  const lineAutoActive = form.tipologie_veicoli.includes("auto") || form.tipologie_veicoli.includes("suv");

  const updateField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const toggleArrayValue = (field, value) => {
    setForm((prev) => {
      const current = prev[field];
      const exists = current.includes(value);
      return { ...prev, [field]: exists ? current.filter((x) => x !== value) : [...current, value] };
    });
  };

  const saveApiKey = () => {
    const clean = apiKeyInput.trim();
    if (!clean) return alert("Inserisci una API key valida.");
    localStorage.setItem(STORAGE_KEY, clean);
    setSavedApiKey(clean);
    setApiKeyInput("");
    alert("API key salvata nel browser.");
  };

  const removeApiKey = () => {
    localStorage.removeItem(STORAGE_KEY);
    setSavedApiKey("");
    setApiKeyInput("");
    alert("API key rimossa.");
  };

  const resetAll = () => {
    setForm(initialForm);
    setResult(null);
    setRawJson("");
    setError("");
    setShowTechnical(false);
    setStep(1);
  };

  const classifyVolume = (v, g) => {
    const veicoli = Number(v || 0);
    const gomme = Number(g || 0);
    if (veicoli >= 16 || gomme >= 61) return "alto";
    if (veicoli >= 6 || gomme >= 21) return "medio";
    return "basso";
  };

  const validateBeforeGenerate = () => {
    if (!savedApiKey) return "Inserisci e salva prima la tua API key.";
    if (!catalogo) return "Catalogo non disponibile.";
    if (!form.tipo_attivita) return "Seleziona il tipo attività.";
    if (form.tipologie_veicoli.length === 0) return "Seleziona almeno una tipologia di veicolo.";
    if (form.servizi_richiesti.length === 0) return "Seleziona almeno un servizio.";
    return "";
  };

  const buildPrompt = (inputData, catalogData) => `
Sei un consulente tecnico-commerciale senior Cormach.

OBIETTIVO:
Configurare in modo corretto una o più linee di officina usando SOLO il catalogo fornito. I codici devono essere presi dal catalogo, che è già allineato al CSV reale. Non usare prezzi.

VINCOLI HARD OBBLIGATORI:
- Non usare prezzi.
- Non inventare modelli, descrizioni o codici fuori catalogo.
- Se l'input include auto/SUV e truck/heavy duty, devi creare DUE RAMI DISTINTI:
  1) linea_auto
  2) linea_truck
- Non mescolare le due linee in una sola proposta.
- Se auto_lock_pref = "nls":
  → DEVI proporre SOLO equilibratrici auto con lock = "nls"
  → NON proporre ghiera rapida o galletto standard come scelta principale
- Se auto_lock_pref = "ghiera_rapida":
  → proponi equilibratrici compatibili con accessorio ghiera rapida
  → NON proporre versioni NLS come scelta principale
- Se auto_lock_pref = "galletto_standard":
  → proponi SOLO versioni standard
- Se auto_monitor_pref = "senza_monitor":
  → proponi SOLO equilibratrici senza monitor
- Se auto_monitor_pref = "con_monitor":
  → proponi SOLO equilibratrici con monitor lcd
- Se auto_monitor_pref = "touch":
  → proponi SOLO equilibratrici touch
- Se truck_smonto_fascia = "entry_26":
  → proponi SOLO FT 26SN come base consigliata
- Se truck_smonto_fascia = "mid_56":
  → proponi FT 560SN o CM SUPER 56N
- Se truck_smonto_fascia = "professional":
  → proponi SUPER VIGOR 2450N o SUPER VIGOR 60
- Se truck_eq_level = "basic":
  → scegli MEC 200 TRUCK o MEC 200-C TRUCK
- Se truck_eq_level = "auto_data":
  → scegli MEC 200A TRUCK o MEC 200A-C TRUCK
- Se truck_eq_level = "top_rlc":
  → scegli MEC 200A-C TRUCK RLC

REGOLE COMMERCIALI:
- Se il cliente cita "spendere poco", "budget contenuto", "senza esagerare", abbassa di un livello la proposta consigliata se tecnicamente possibile.
- Base = essenziale ma corretta.
- Consigliata = miglior compromesso reale.
- Premium = upgrade vero.

OUTPUT:
Per OGNI smontagomme, equilibratrice e accessorio devi sempre restituire:
- code
- model/name
- csv_description
- details: array di dettagli tecnici sintetici
- difference: differenza chiave rispetto alle altre versioni
- motivo

FORMATO JSON OBBLIGATORIO:
{
  "profilo_officina": {
    "sintesi": "string",
    "classe_volume": "basso|medio|alto",
    "misto_auto_truck": true
  },
  "linea_auto": {
    "attiva": true,
    "base": {
      "smontagomme": {"code":"string|da definire","model":"string","csv_description":"string","details":["string"],"difference":"string","motivo":"string"},
      "equilibratrice": {"code":"string|da definire","model":"string","csv_description":"string","details":["string"],"difference":"string","motivo":"string"},
      "accessori": [{"code":"string","name":"string","details":["string"],"difference":"string","motivo":"string"}]
    },
    "consigliata": {
      "smontagomme": {"code":"string|da definire","model":"string","csv_description":"string","details":["string"],"difference":"string","motivo":"string"},
      "equilibratrice": {"code":"string|da definire","model":"string","csv_description":"string","details":["string"],"difference":"string","motivo":"string"},
      "accessori": [{"code":"string","name":"string","details":["string"],"difference":"string","motivo":"string"}]
    },
    "premium": {
      "smontagomme": {"code":"string|da definire","model":"string","csv_description":"string","details":["string"],"difference":"string","motivo":"string"},
      "equilibratrice": {"code":"string|da definire","model":"string","csv_description":"string","details":["string"],"difference":"string","motivo":"string"},
      "accessori": [{"code":"string","name":"string","details":["string"],"difference":"string","motivo":"string"}]
    }
  },
  "linea_truck": {
    "attiva": true,
    "base": {
      "smontagomme": {"code":"string|da definire","model":"string","csv_description":"string","details":["string"],"difference":"string","motivo":"string"},
      "equilibratrice": {"code":"string|da definire","model":"string","csv_description":"string","details":["string"],"difference":"string","motivo":"string"},
      "gabbia_gonfiaggio": {"necessaria": true, "code":"string|da definire","model":"string","details":["string"],"difference":"string","motivo":"string"},
      "accessori": [{"code":"string","name":"string","details":["string"],"difference":"string","motivo":"string"}]
    },
    "consigliata": {
      "smontagomme": {"code":"string|da definire","model":"string","csv_description":"string","details":["string"],"difference":"string","motivo":"string"},
      "equilibratrice": {"code":"string|da definire","model":"string","csv_description":"string","details":["string"],"difference":"string","motivo":"string"},
      "gabbia_gonfiaggio": {"necessaria": true, "code":"string|da definire","model":"string","details":["string"],"difference":"string","motivo":"string"},
      "accessori": [{"code":"string","name":"string","details":["string"],"difference":"string","motivo":"string"}]
    },
    "premium": {
      "smontagomme": {"code":"string|da definire","model":"string","csv_description":"string","details":["string"],"difference":"string","motivo":"string"},
      "equilibratrice": {"code":"string|da definire","model":"string","csv_description":"string","details":["string"],"difference":"string","motivo":"string"},
      "gabbia_gonfiaggio": {"necessaria": true, "code":"string|da definire","model":"string","details":["string"],"difference":"string","motivo":"string"},
      "accessori": [{"code":"string","name":"string","details":["string"],"difference":"string","motivo":"string"}]
    }
  },
  "note_operative": ["string"],
  "domande_successive": ["string"]
}

CATALOGO:
${JSON.stringify(catalogData, null, 2)}

INPUT:
${JSON.stringify(inputData, null, 2)}
`.trim();

  const extractResponseText = (data) => data?.candidates?.[0]?.content?.parts?.map((p) => p?.text || "").join("") || "";

  const generateConfiguration = async () => {
    const validationError = validateBeforeGenerate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    setRawJson("");

    try {
      const preparedInput = {
        ...form,
        volume_veicoli_giorno: Number(form.volume_veicoli_giorno || 0),
        volume_gomme_giorno: Number(form.volume_gomme_giorno || 0),
        classe_volume_stimata: classifyVolume(form.volume_veicoli_giorno, form.volume_gomme_giorno)
      };

      const prompt = buildPrompt(preparedInput, catalogo);
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": savedApiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, topP: 0.9 }
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || "Errore nella chiamata al modello.");
      const cleanedText = cleanJsonResponse(extractResponseText(data));
      setRawJson(cleanedText);
      setResult(JSON.parse(cleanedText));
      setStep(8);
    } catch (err) {
      console.error(err);
      setError(err.message || "Errore nella generazione.");
    } finally {
      setLoading(false);
    }
  };

  const copyText = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(exportCommercialText(result));
      alert("Testo copiato negli appunti.");
    } catch {
      alert("Impossibile copiare automaticamente.");
    }
  };

  const openWhatsApp = () => {
    if (!result) return;
    const text = encodeURIComponent(exportCommercialText(result));
    window.open(`https://wa.me/?text=${text}`, "_blank");
  };

  const renderStep = () => {
    switch (step) {
      case 1:
        return <Section title="1. Attività">
          <Field label="Tipo attività">
            <select value={form.tipo_attivita} onChange={(e)=>updateField("tipo_attivita", e.target.value)}>
              <option value="">Seleziona</option>
              <option value="gommista">Gommista</option>
              <option value="officina_meccanica">Officina meccanica</option>
              <option value="centro_completo">Centro completo</option>
            </select>
          </Field>
          <Field label="Business prevalente">
            <select value={form.business_prevalente} onChange={(e)=>updateField("business_prevalente", e.target.value)}>
              <option value="">Seleziona</option>
              <option value="auto">Auto</option>
              <option value="auto_suv">Auto + SUV</option>
              <option value="truck">Truck</option>
              <option value="misto">Misto</option>
            </select>
          </Field>
        </Section>;
      case 2:
        return <Section title="2. Veicoli trattati">
          <CheckboxGroup
            options={[
              {value:"auto",label:"Auto"},
              {value:"suv",label:"SUV"},
              {value:"truck",label:"Truck"},
              {value:"heavy_duty",label:"Heavy duty"}
            ]}
            values={form.tipologie_veicoli}
            onToggle={(v)=>toggleArrayValue("tipologie_veicoli", v)}
          />
        </Section>;
      case 3:
        return <Section title="3. Volume di lavoro">
          <Field label="Veicoli al giorno">
            <input type="number" min="0" value={form.volume_veicoli_giorno} onChange={(e)=>updateField("volume_veicoli_giorno", e.target.value)} />
          </Field>
          <Field label="Gomme al giorno">
            <input type="number" min="0" value={form.volume_gomme_giorno} onChange={(e)=>updateField("volume_gomme_giorno", e.target.value)} />
          </Field>
        </Section>;
      case 4:
        return <Section title="4. Servizi e specializzazioni">
          <Field label="Servizi richiesti">
            <CheckboxGroup
              options={[
                {value:"smontagomme",label:"Smontagomme"},
                {value:"equilibratura",label:"Equilibratura"},
                {value:"assetto_ruote",label:"Assetto ruote"},
                {value:"sollevamento",label:"Sollevamento"},
                {value:"gonfiaggio",label:"Gabbia / gonfiaggio"}
              ]}
              values={form.servizi_richiesti}
              onToggle={(v)=>toggleArrayValue("servizi_richiesti", v)}
            />
          </Field>
          <Field label="Specializzazioni">
            <CheckboxGroup
              options={[
                {value:"runflat",label:"Runflat"},
                {value:"ribassati",label:"Ribassati"},
                {value:"servizio_rapido",label:"Servizio rapido"},
                {value:"premium",label:"Clientela premium"}
              ]}
              values={form.specializzazioni}
              onToggle={(v)=>toggleArrayValue("specializzazioni", v)}
            />
          </Field>
        </Section>;
      case 5:
        return <Section title="5. Officina">
          <Field label="Spazio officina">
            <select value={form.spazio_officina} onChange={(e)=>updateField("spazio_officina", e.target.value)}>
              <option value="">Seleziona</option>
              <option value="piccolo">Piccolo</option>
              <option value="medio">Medio</option>
              <option value="grande">Grande</option>
            </select>
          </Field>
          <Field label="Pavimentazione">
            <select value={form.pavimentazione} onChange={(e)=>updateField("pavimentazione", e.target.value)}>
              <option value="">Seleziona</option>
              <option value="industriale">Industriale</option>
              <option value="non_industriale">Non industriale</option>
            </select>
          </Field>
          <Field label="Livello operatore">
            <select value={form.livello_operatore} onChange={(e)=>updateField("livello_operatore", e.target.value)}>
              <option value="">Seleziona</option>
              <option value="base">Base</option>
              <option value="medio">Medio</option>
              <option value="esperto">Esperto</option>
            </select>
          </Field>
        </Section>;
      case 6:
        return <Section title="6. Preferenze auto / truck">
          {lineAutoActive && <>
            <Field label="Equilibratrice auto: preferenza monitor">
              <select value={form.auto_monitor_pref} onChange={(e)=>updateField("auto_monitor_pref", e.target.value)}>
                <option value="">Nessuna preferenza</option>
                <option value="senza_monitor">Senza monitor</option>
                <option value="con_monitor">Con monitor</option>
                <option value="touch">Touch</option>
              </select>
            </Field>
            <Field label="Equilibratrice auto: preferenza bloccaggio">
              <select value={form.auto_lock_pref} onChange={(e)=>updateField("auto_lock_pref", e.target.value)}>
                <option value="">Nessuna preferenza</option>
                <option value="galletto_standard">Galletto standard</option>
                <option value="ghiera_rapida">Ghiera rapida</option>
                <option value="nls">NLS pneumatico</option>
              </select>
            </Field>
          </>}
          {lineTruckActive && <>
            <Field label="Smontagomme truck: fascia desiderata">
              <select value={form.truck_smonto_fascia} onChange={(e)=>updateField("truck_smonto_fascia", e.target.value)}>
                <option value="">Da valutare</option>
                <option value="entry_26">Entry level fino a 26"</option>
                <option value="mid_56">Fascia media / 56"</option>
                <option value="professional">Professionale</option>
              </select>
            </Field>
            <Field label="Equilibratrice truck: livello">
              <select value={form.truck_eq_level} onChange={(e)=>updateField("truck_eq_level", e.target.value)}>
                <option value="">Da valutare</option>
                <option value="basic">Base</option>
                <option value="auto_data">Con acquisizione automatica dati</option>
                <option value="top_rlc">Top con RLC</option>
              </select>
            </Field>
          </>}
        </Section>;
      case 7:
        return <Section title="7. Priorità e note">
          <Field label="Priorità cliente">
            <select value={form.priorita_cliente} onChange={(e)=>updateField("priorita_cliente", e.target.value)}>
              <option value="">Seleziona</option>
              <option value="risparmio">Risparmio</option>
              <option value="produttivita">Produttività</option>
              <option value="ergonomia">Ergonomia</option>
              <option value="immagine_officina">Immagine officina</option>
            </select>
          </Field>
          <ToggleRow label="Richiede leverless" checked={form.richiede_leverless} onChange={(v)=>updateField("richiede_leverless", v)} />
          <ToggleRow label="Richiede assetto" checked={form.richiede_assetto} onChange={(v)=>updateField("richiede_assetto", v)} />
          <ToggleRow label="Richiede gabbia gonfiaggio" checked={form.richiede_gabbia_gonfiaggio} onChange={(v)=>updateField("richiede_gabbia_gonfiaggio", v)} />
          <Field label="Note cliente">
            <textarea rows="5" value={form.note_cliente} onChange={(e)=>updateField("note_cliente", e.target.value)} placeholder="Es. Necessità di smontagomme truck e gabbia gonfiaggio. Budget contenuto." />
          </Field>
        </Section>;
      case 8:
        return <Section title="8. Configurazione pronta">
          {result ? <ResultView result={result} showTechnical={showTechnical} rawJson={rawJson} onToggleTechnical={()=>setShowTechnical(!showTechnical)} /> : <p>Nessun risultato disponibile.</p>}
        </Section>;
      default:
        return null;
    }
  };

  return (
    <div className="app-shell">
      <div className="container">
        <header className="hero">
          <h1>Configuratore Cormach V6</h1>
          <p>Codici e descrizioni allineati al CSV reale. Prezzi esclusi.</p>
        </header>

        <div className="card">
          <h2>API Key Google AI</h2>
          <input type="password" placeholder="Incolla la tua API key" value={apiKeyInput} onChange={(e)=>setApiKeyInput(e.target.value)} />
          <div className="actions-row">
            <button className="primary" onClick={saveApiKey}>Salva key</button>
            <button className="secondary" onClick={removeApiKey}>Rimuovi</button>
          </div>
          <p className="meta">Stato chiave: <strong>{savedApiKey ? "salvata in questo browser" : "non salvata"}</strong></p>
        </div>

        <div className="progress-wrap">
          <div className="progress"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
          <p className="progress-text">Step {step} di 8</p>
        </div>

        {catalogoError && <div className="error">{catalogoError}</div>}
        {error && <div className="error">{error}</div>}

        <div className="card">{renderStep()}</div>

        <div className="footer-actions">
          {step > 1 && step < 8 && <button className="secondary" onClick={() => setStep(step - 1)}>Indietro</button>}
          {step < 7 && <button className="primary" onClick={() => setStep(step + 1)}>Avanti</button>}
          {step === 7 && <button className="primary" onClick={generateConfiguration} disabled={loading}>{loading ? "Generazione..." : "Genera configurazione"}</button>}
          {step === 8 && result && <>
            <button className="secondary" onClick={() => setStep(7)}>Modifica dati</button>
            <button className="secondary" onClick={copyText}>Copia testo</button>
            <button className="secondary wa" onClick={openWhatsApp}>Apri WhatsApp</button>
            <button className="primary" onClick={resetAll}>Nuova configurazione</button>
          </>}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return <section><h2 className="section-title">{title}</h2>{children}</section>;
}

function Field({ label, children }) {
  return <label className="field"><span className="label">{label}</span>{children}</label>;
}

function CheckboxGroup({ options, values, onToggle }) {
  return <div className="checkbox-group">{options.map((opt)=><label key={opt.value} className="checkbox-item"><input type="checkbox" checked={values.includes(opt.value)} onChange={()=>onToggle(opt.value)} /><span>{opt.label}</span></label>)}</div>;
}

function ToggleRow({ label, checked, onChange }) {
  return <label className="toggle-row"><span>{label}</span><input type="checkbox" checked={checked} onChange={(e)=>onChange(e.target.checked)} /></label>;
}

function MachineBlock({ title, item }) {
  return (
    <div className="machine-block">
      <h5>{title}</h5>
      <p><strong>Codice:</strong> {item?.code || "da definire"}</p>
      <p><strong>Modello:</strong> {item?.model || item?.name || "-"}</p>
      {item?.csv_description && <p><strong>Descrizione CSV:</strong> {item.csv_description}</p>}
      <p><strong>Dettagli:</strong> {(item?.details || []).join(", ") || "-"}</p>
      <p><strong>Differenze:</strong> {item?.difference || "-"}</p>
      <p><strong>Motivo:</strong> {item?.motivo || "-"}</p>
    </div>
  );
}

function OfferCard({ title, data, truck=false }) {
  if (!data) return null;
  return (
    <div className="offer-card">
      <h4>{title}</h4>
      <MachineBlock title="Smontagomme" item={data?.smontagomme} />
      <MachineBlock title="Equilibratrice" item={data?.equilibratrice} />
      {truck && <MachineBlock title="Gabbia gonfiaggio" item={data?.gabbia_gonfiaggio} />}
      {(data?.accessori || []).length > 0 && (
        <div className="machine-block">
          <h5>Accessori</h5>
          {(data.accessori || []).map((a, idx) => (
            <div key={idx} className="accessory-item">
              <p><strong>Codice:</strong> {a.code || "-"}</p>
              <p><strong>Nome:</strong> {a.name || "-"}</p>
              <p><strong>Dettagli:</strong> {(a.details || []).join(", ") || "-"}</p>
              <p><strong>Differenze:</strong> {a.difference || "-"}</p>
              <p><strong>Motivo:</strong> {a.motivo || "-"}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ResultView({ result, showTechnical, rawJson, onToggleTechnical }) {
  const auto = result?.linea_auto || {};
  const truck = result?.linea_truck || {};
  return (
    <div className="result-wrap">
      <div className="result-block hero-result">
        <h3>Profilo officina</h3>
        <p>{result?.profilo_officina?.sintesi || "-"}</p>
        <p><strong>Classe volume:</strong> {result?.profilo_officina?.classe_volume || "-"}</p>
      </div>

      {auto?.attiva && (
        <div className="result-block">
          <h3>Linea auto</h3>
          <div className="offer-grid">
            <OfferCard title="Base" data={auto.base} />
            <OfferCard title="Consigliata" data={auto.consigliata} />
            <OfferCard title="Premium" data={auto.premium} />
          </div>
        </div>
      )}

      {truck?.attiva && (
        <div className="result-block">
          <h3>Linea truck</h3>
          <div className="offer-grid">
            <OfferCard title="Base" data={truck.base} truck />
            <OfferCard title="Consigliata" data={truck.consigliata} truck />
            <OfferCard title="Premium" data={truck.premium} truck />
          </div>
        </div>
      )}

      <div className="result-block">
        <h3>Note operative</h3>
        <ul>{(result?.note_operative || []).map((n, idx)=><li key={idx}>{n}</li>)}</ul>
      </div>

      <div className="result-block">
        <h3>Domande successive</h3>
        <ul>{(result?.domande_successive || []).map((n, idx)=><li key={idx}>{n}</li>)}</ul>
      </div>

      <div className="result-block">
        <button className="secondary" onClick={onToggleTechnical}>
          {showTechnical ? "Nascondi JSON tecnico" : "Mostra JSON tecnico"}
        </button>
      </div>

      {showTechnical && (
        <details className="result-block" open>
          <summary>JSON tecnico</summary>
          <pre>{rawJson}</pre>
        </details>
      )}
    </div>
  );
}
