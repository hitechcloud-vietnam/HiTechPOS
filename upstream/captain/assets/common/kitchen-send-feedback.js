(function () {
  'use strict';
  let generation = 0;
  async function occupancyOutsideFloor() {
    let timer;
    try {
      const response = await Promise.race([
        window.POSNIC.api.get('/captain/v1/tables'),
        new Promise(resolve => { timer = setTimeout(() => resolve(null), 500); }),
      ]);
      if (!Array.isArray(response?.tables)) return null;
      const rows = new Map(response.tables.filter(row => row.tableorder_value != null).map(row => [String(row.tableorder_value), row]));
      return { total: rows.size, occupied: [...rows.values()].filter(row => row.status === 'occupied').length };
    } catch { return null; }
    finally { clearTimeout(timer); }
  }
  window.CaptainKitchenFeedback = {
    async play() {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const ticket = ++generation;
      let occupancy = window.CaptainFloorOccupancy?.();
      if (!occupancy && window.POSNIC?.session?.active && !window.CaptainAccess?.locked) {
        const owner = window.POSNIC.session.shopKey, user = window.POSNIC.session.user?.id, branch = localStorage.getItem('branch_id');
        occupancy = await occupancyOutsideFloor();
        if (ticket !== generation || !window.POSNIC.session.active || window.CaptainAccess?.locked || owner !== window.POSNIC.session.shopKey || user !== window.POSNIC.session.user?.id || branch !== localStorage.getItem('branch_id')) return;
      }
      document.querySelector('.kitchen-send-flight')?.remove();
      const flight = document.createElement('div');
      flight.className = 'kitchen-send-flight';
      flight.setAttribute('aria-hidden', 'true');
      flight.innerHTML = '<svg class="kitchen-flight-dish" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 24h24M6 21a10 10 0 0 1 20 0Z M16 8v3m-2-3h4"/></svg><svg class="kitchen-flight-plane" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="m3 10 18-7-7 18-3-8-8-3Z m8 3L21 3"/></svg>';
      if (occupancy?.total > 0 && occupancy.occupied / occupancy.total >= .7) {
        flight.classList.add('kitchen-chef-flight');
        flight.querySelector('.kitchen-flight-plane').remove();
        const chef = document.createElement('span');
        chef.className = 'kitchen-chef-runner';
        chef.innerHTML = '<span class="kitchen-chef-person">👨‍🍳</span><span class="kitchen-chef-meal">🍲</span>';
        const finish = document.createElement('span');
        finish.className = 'kitchen-chef-finish';
        finish.textContent = '👍';
        flight.append(chef, finish);
      }
      document.body.appendChild(flight);
      setTimeout(() => flight.remove(), 2050);
    }
  };
  window.addEventListener('posnic:orders-sent', () => window.CaptainKitchenFeedback.play());
})();
