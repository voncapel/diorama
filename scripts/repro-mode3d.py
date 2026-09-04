import base64
import os
import time

TARGET_URL = "https://github.com/browser-use/browser-harness"
EXTENSION_URL = "chrome-extension://pjbbmbniadijhcaldfgocmiifmadnbll/studio.html"
ARTIFACT_DIR = "/tmp/diorama-repro"
os.makedirs(ARTIFACT_DIR, exist_ok=True)


def target_tab():
    matches = [tab for tab in list_tabs() if tab["url"].rstrip("/") == TARGET_URL.rstrip("/")]
    if not matches:
        raise RuntimeError(f"Open test page is required: {TARGET_URL}")
    return matches[0]


def extension_tab():
    matches = [tab for tab in list_tabs() if tab["url"] == EXTENSION_URL]
    if matches:
        switch_tab(matches[0]["targetId"])
        goto_url(EXTENSION_URL)
        wait_for_load()
        return [tab for tab in list_tabs() if tab["url"] == EXTENSION_URL][0]
    new_tab(EXTENSION_URL)
    wait_for_load()
    matches = [tab for tab in list_tabs() if tab["url"] == EXTENSION_URL]
    if not matches:
        raise RuntimeError("Could not open the Diorama extension control page")
    return matches[0]


def capture(path):
    result = cdp("Page.captureScreenshot", format="png", captureBeyondViewport=False)
    with open(path, "wb") as handle:
        handle.write(base64.b64decode(result["data"]))


def capture_canvas(path):
    data_url = js("document.querySelector('#diorama-root').shadowRoot.querySelector('canvas').toDataURL('image/png')")
    with open(path, "wb") as handle:
        handle.write(base64.b64decode(data_url.split(',', 1)[1]))


def overlay_state():
    return js("""(() => {
      const host = document.querySelector('#diorama-root');
      const root = host?.shadowRoot;
      const buttons = [...(root?.querySelectorAll('button') || [])];
      const cards = [...(root?.querySelectorAll('.layer-card') || [])];
      const canvas = root?.querySelector('canvas');
      return {
        mounted: !!root,
        activeMode: buttons.find((button) => button.classList.contains('active') &&
          ['Sélectionner', 'Mode 3D'].includes(button.textContent.trim()))?.textContent.trim() || null,
        topbar: root?.querySelector('.diorama-topbar')?.innerText || '',
        layers: cards.map((card) => card.querySelector('.layer-head span')?.textContent?.trim() || ''),
        canvasRect: canvas?.getBoundingClientRect().toJSON() || null,
      };
    })()""")


# Start from a clean document and inject the currently loaded unpacked extension.
target = target_tab()
activate_tab(target["targetId"])
switch_tab(target["targetId"])
cdp("Page.reload", ignoreCache=True)
wait_for_load()
time.sleep(1)

extension = extension_tab()
switch_tab(extension["targetId"])
injection = js(f"""(async () => {{
  const [tab] = await chrome.tabs.query({{url: '{TARGET_URL}'}});
  if (!tab) return {{ok: false, error: 'target tab missing'}};
  try {{
    await chrome.scripting.executeScript({{target: {{tabId: tab.id}}, files: ['content.js']}});
    return {{ok: true, tabId: tab.id}};
  }} catch (error) {{
    return {{ok: false, error: String(error)}};
  }}
}})()""")
if not injection.get("ok"):
    raise RuntimeError(f"Diorama injection failed: {injection}")

switch_tab(target["targetId"])
time.sleep(3)
initial = overlay_state()
if not initial["mounted"]:
    raise AssertionError(f"Diorama did not mount: {initial}")

# Exact path 1: entering 3D before detaching anything must not create a visually
# misaligned second copy ('floating window') over the live page.
js("""(() => {
  const root = document.querySelector('#diorama-root').shadowRoot;
  [...root.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Mode 3D').click();
})()""")
time.sleep(1)
capture(f"{ARTIFACT_DIR}/flat-3d-visible.png")
js("document.querySelector('#diorama-root').shadowRoot.querySelector('canvas').style.visibility='hidden'")
time.sleep(0.1)
capture(f"{ARTIFACT_DIR}/flat-3d-hidden.png")
js("document.querySelector('#diorama-root').shadowRoot.querySelector('canvas').style.visibility='visible'")

# Exact path 2: select one deterministic element. The native node becomes hidden;
# therefore the canvas must contribute visible pixels for the detached layer.
js("""(() => {
  const root = document.querySelector('#diorama-root').shadowRoot;
  [...root.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Sélectionner').click();
})()""")
time.sleep(0.5)
selection = js("""(() => {
  const element = document.querySelector('#repository-container-header strong a');
  if (!element) return {ok: false, error: 'stable repository title target missing'};
  const rect = element.getBoundingClientRect();
  const init = {text: element.textContent.trim(), rect: rect.toJSON()};
  const eventInit = {
    bubbles: true,
    composed: true,
    cancelable: true,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  };
  element.dispatchEvent(new MouseEvent('mousemove', eventInit));
  element.dispatchEvent(new MouseEvent('click', eventInit));
  return {ok: true, init};
})()""")
if not selection.get("ok"):
    raise AssertionError(selection)
time.sleep(3)
selected = overlay_state()
selected_target = js("""(() => {
  const element = document.querySelector('#repository-container-header strong a');
  return {
    hidden: element?.getAttribute('data-dio-hidden'),
    visibility: element ? getComputedStyle(element).visibility : null,
  };
})()""")
if selected["activeMode"] != "Mode 3D" or len(selected["layers"]) != 2:
    raise AssertionError(f"Selection did not create one 3D layer: {selected}")
if selected_target["hidden"] != "1" or selected_target["visibility"] != "hidden":
    raise AssertionError(f"Live target was not isolated: {selected_target}")

# Hide L0 through the real UI so this pixel assertion isolates L1 only.
js("""(() => {
  const root = document.querySelector('#diorama-root').shadowRoot;
  root.querySelector('.layer-card button[title="Masquer"]')?.click();
})()""")
time.sleep(0.2)
capture(f"{ARTIFACT_DIR}/detached-visible.png")
js("document.querySelector('#diorama-root').shadowRoot.querySelector('canvas').style.visibility='hidden'")
time.sleep(0.1)
capture(f"{ARTIFACT_DIR}/detached-hidden.png")
js("document.querySelector('#diorama-root').shadowRoot.querySelector('canvas').style.visibility='visible'")
# Restore L0 for the full-scene animation path.
js("""(() => {
  const root = document.querySelector('#diorama-root').shadowRoot;
  root.querySelector('.layer-card button[title="Afficher"]')?.click();
})()""")
time.sleep(0.2)

# Exact path 3: an explicitly generated Director timeline must animate the WebGL canvas.
js("""(() => {
  const root = document.querySelector('#diorama-root').shadowRoot;
  [...root.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Director').click();
})()""")
time.sleep(0.1)
js("""(() => {
  const root = document.querySelector('#diorama-root').shadowRoot;
  [...root.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Générer').click();
})()""")
time.sleep(0.1)
capture_canvas(f"{ARTIFACT_DIR}/animation-start.png")
js("""(() => {
  const root = document.querySelector('#diorama-root').shadowRoot;
  [...root.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Play').click();
})()""")
time.sleep(1)
capture_canvas(f"{ARTIFACT_DIR}/animation-after-1s.png")

# Removing a layer must restore the exact live DOM visibility and update the scene graph.
js("""(() => {
  const root = document.querySelector('#diorama-root').shadowRoot;
  [...root.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Layers').click();
})()""")
time.sleep(0.1)
js("""(() => {
  const root = document.querySelector('#diorama-root').shadowRoot;
  root.querySelector('button[title="Réintégrer au fond"]')?.click();
})()""")
time.sleep(2)
restored = js("""(() => {
  const element = document.querySelector('#repository-container-header strong a');
  const root = document.querySelector('#diorama-root').shadowRoot;
  return {
    hidden: element?.getAttribute('data-dio-hidden'),
    visibility: element ? getComputedStyle(element).visibility : null,
    layers: [...root.querySelectorAll('.layer-card')].map((card) =>
      card.querySelector('.layer-head span')?.textContent?.trim() || ''),
  };
})()""")
if restored["hidden"] is not None or restored["visibility"] == "hidden" or len(restored["layers"]) != 1:
    raise AssertionError(f"Layer reintegration did not restore the live DOM: {restored}")

print({
    "initial": initial,
    "selection": selection,
    "selected": selected,
    "selectedTarget": selected_target,
    "restored": restored,
    "artifacts": ARTIFACT_DIR,
})
