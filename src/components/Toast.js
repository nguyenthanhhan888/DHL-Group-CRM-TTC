export const Toast = {
  mount() {},

  show(message) {
    const container = document.querySelector('[data-toast-container]');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('leaving');
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
    }, 3000);
  },
};

