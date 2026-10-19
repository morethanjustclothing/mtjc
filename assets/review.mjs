const $ = id => document.getElementById(id);
const code = (new URLSearchParams(location.search).get("code") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const words = { 1: "Poor", 2: "Fair", 3: "Good", 4: "Great", 5: "Excellent" };

function bad(msg) { $("checking").hidden = true; $("badLink").hidden = false; $("badLink").textContent = msg; }

(async function check() {
  if (code.length !== 8) return bad("This review link isn't complete. Please use the full link you were sent.");
  try {
    const r = await fetch(`/api/review-check?code=${code}`, { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return bad(d.error || "This review link isn't valid.");
    $("checking").hidden = true; $("revForm").hidden = false;
    if (d.name) $("f-name").value = d.name;
  } catch { bad("Couldn't load the review form. Check your connection and try again."); }
})();

document.querySelectorAll('#stars input').forEach(i => i.addEventListener("change", () => {
  $("ratingText").textContent = `${i.value} out of 5 · ${words[i.value]}`;
}));

$("revForm").addEventListener("submit", async e => {
  e.preventDefault();
  const err = $("formErr"); err.textContent = "";
  const rating = Number(document.querySelector('#stars input:checked')?.value || 0);
  const name = $("f-name").value.trim(), text = $("f-text").value.trim();
  if (!rating) return err.textContent = "Tap the stars to choose a rating.";
  if (!name) { $("f-name").focus(); return err.textContent = "Add your first name."; }
  if (text.length < 5) { $("f-text").focus(); return err.textContent = "Write a few words about your visit."; }
  $("sendBtn").disabled = true; $("sendBtn").textContent = "Sending…";
  try {
    const r = await fetch("/api/review", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, rating, name, text, website: $("f-website").value }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { err.textContent = d.error || "Couldn't send your review. Please try again."; return; }
    $("revForm").hidden = true; $("intro").hidden = true; $("thanks").hidden = false;
  } catch { err.textContent = "Couldn't send your review. Check your connection and try again."; }
  finally { $("sendBtn").disabled = false; $("sendBtn").textContent = "Send review"; }
});
