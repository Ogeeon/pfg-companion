// Entry point of both builds. The userscript and the extension must not collect together (a second accountInfo
// request would mark the player active again): whoever starts first marks the document and the other stands down.
(function () {
  if (document.documentElement.dataset.pfgCompanion) return;
  document.documentElement.dataset.pfgCompanion = PLATFORM;

  void (async () => {
    await initSnapshots();
    if (!ON_GAME) {
      handOffToSite();
      onSnapshotsChanged(handOffToSite);
      return;
    }
    debug('game component:', GAME_COMPONENT, 'url:', location.href);
    // Read before the account request, so the reading is dated by the page the player loaded.
    const barReading = readResourceBar();
    installGameUi();
    // The panel opens only on click; if the player opened it while collection was running, show fresh data.
    const updateOpenPanel = () => {
      if (!document.getElementById('pfg-companion-panel')?.classList.contains('pfg-open')) return;
      showPanel(activeEntry());
    };
    try {
      await collectAccount();
      debug('collection flow: collectAccount resolved, saving resources and production factors and refreshing UI');
      saveBodyResources(await barReading);
      savePlanetOrder();
      saveProductionFactors();
    } catch (error) {
      debug('collection flow: collectAccount FAILED:', error);
      recordError(error);
      saveBodyResources(await barReading);
      savePlanetOrder();
    }
    refreshGameUi();
    updateOpenPanel();
  })();
}());
