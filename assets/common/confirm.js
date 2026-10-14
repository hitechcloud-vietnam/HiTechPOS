/* Shared destructive-action confirmation. Back always keeps the draft. */
(function (root) {
  'use strict';
  let active = null;
  const t = value => root.I18N?.t(value) || value;
  function discard(options = {}) {
    // A second tap must not attach a second destructive continuation.
    if (active) return Promise.resolve(false);
    const previous = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.id = 'captain-discard';
    dialog.setAttribute('aria-labelledby', 'captain-discard-title');
    const title = document.createElement('h2');
    title.id = 'captain-discard-title';
    title.textContent = t('Discard changes?');
    const footer = document.createElement('footer');
    for (const [action, label] of [['keep', 'Keep editing'], ['discard', 'Discard changes']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.confirmAction = action;
      button.textContent = t(label);
      footer.append(button);
    }
    dialog.append(title);
    if (options.details) {
      const details = document.createElement('p');
      details.textContent = options.details;
      dialog.append(details);
    }
    dialog.append(footer);
    document.body.append(dialog);
    return new Promise(resolve => {
      const finish = value => {
        if (active !== dialog) return;
        active = null;
        window.removeEventListener('captain:back', back, true);
        dialog.close();
        dialog.remove();
        if (previous?.isConnected) previous.focus({preventScroll:true});
        resolve(value);
      };
      const back = event => { event.preventDefault(); event.stopImmediatePropagation(); finish(false); };
      active = dialog;
      window.addEventListener('captain:back', back, true);
      dialog.addEventListener('cancel', back);
      dialog.addEventListener('click', event => {
        const action = event.target.closest('[data-confirm-action]')?.dataset.confirmAction;
        if (action) finish(action === 'discard');
      });
      dialog.showModal();
      footer.firstElementChild.focus();
    });
  }
  root.CaptainConfirm = {discard, get active() { return !!active; }};
})(window);
