export async function findStudioTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL('studio.html') });
  return tabs[0];
}

export async function openOrFocusStudio(): Promise<number> {
  const studio = await findStudioTab();
  if (studio?.id) {
    await chrome.tabs.update(studio.id, { active: true });
    if (studio.windowId !== undefined) {
      await chrome.windows.update(studio.windowId, { focused: true }).catch(() => undefined);
    }
    return studio.id;
  }
  const tab = await chrome.tabs.create({ url: chrome.runtime.getURL('studio.html') });
  if (!tab.id) throw new Error('Could not create studio tab');
  if (tab.windowId !== undefined) {
    await chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
  }
  return tab.id;
}
