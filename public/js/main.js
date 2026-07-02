/* ===== VILLA MARIS TIBURON — MAIN JAVASCRIPT ===== */

document.addEventListener('DOMContentLoaded', () => {

  // ===== NAVIGATION =====
  const nav = document.querySelector('.nav');
  const navToggle = document.querySelector('.nav-toggle');
  const mobileMenu = document.querySelector('.mobile-menu');
  const mobileClose = document.querySelector('.mobile-close');
  const stickyBar = document.querySelector('.sticky-book-bar');

  if (nav) {
    window.addEventListener('scroll', () => {
      if (window.scrollY > 80) {
        nav.classList.add('scrolled');
      } else {
        nav.classList.remove('scrolled');
      }
      if (stickyBar) {
        if (window.scrollY > 600) {
          stickyBar.classList.add('show');
        } else {
          stickyBar.classList.remove('show');
        }
      }
    });
  }

  if (navToggle && mobileMenu) {
    navToggle.addEventListener('click', () => {
      mobileMenu.classList.add('open');
      document.body.style.overflow = 'hidden';
    });
  }

  if (mobileClose && mobileMenu) {
    mobileClose.addEventListener('click', () => {
      mobileMenu.classList.remove('open');
      document.body.style.overflow = '';
    });
  }

  // Close mobile menu on link click
  if (mobileMenu) {
    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        mobileMenu.classList.remove('open');
        document.body.style.overflow = '';
      });
    });
  }

  // Set active nav link
  const currentPath = window.location.pathname;
  document.querySelectorAll('.nav-links a').forEach(link => {
    if (link.getAttribute('href') === currentPath || 
        (currentPath === '/' && link.getAttribute('href') === '/') ||
        (currentPath !== '/' && link.getAttribute('href') !== '/' && currentPath.includes(link.getAttribute('href')))) {
      link.classList.add('active');
    }
  });

  // ===== HERO SLIDESHOW =====
  const slides = document.querySelectorAll('.hero-slide');
  const dots = document.querySelectorAll('.hero-dot');
  let currentSlide = 0;
  let slideInterval;

  function goToSlide(index) {
    slides.forEach(s => s.classList.remove('active'));
    dots.forEach(d => d.classList.remove('active'));
    currentSlide = index;
    if (slides[currentSlide]) slides[currentSlide].classList.add('active');
    if (dots[currentSlide]) dots[currentSlide].classList.add('active');
  }

  function nextSlide() {
    goToSlide((currentSlide + 1) % slides.length);
  }

  if (slides.length > 0) {
    goToSlide(0);
    slideInterval = setInterval(nextSlide, 6000);

    dots.forEach((dot, i) => {
      dot.addEventListener('click', () => {
        clearInterval(slideInterval);
        goToSlide(i);
        slideInterval = setInterval(nextSlide, 6000);
      });
    });
  }

  // ===== REVEAL ON SCROLL =====
  const revealElements = document.querySelectorAll('.reveal');

  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -60px 0px' });

  revealElements.forEach(el => revealObserver.observe(el));

  // ===== LIGHTBOX =====
  const lightbox = document.querySelector('.lightbox');
  const lightboxImg = lightbox ? lightbox.querySelector('img') : null;
  const galleryItems = document.querySelectorAll('.gallery-item');
  let lightboxImages = [];
  let currentLightboxIndex = 0;

  if (lightbox) {
    galleryItems.forEach((item, i) => {
      const img = item.querySelector('img');
      if (img) {
        lightboxImages.push(img.src);
        item.addEventListener('click', () => {
          currentLightboxIndex = i;
          openLightbox(i);
        });
      }
    });

    function openLightbox(index) {
      if (!lightboxImg) return;
      lightboxImg.src = lightboxImages[index];
      lightbox.classList.add('open');
      document.body.style.overflow = 'hidden';
    }

    function closeLightbox() {
      lightbox.classList.remove('open');
      document.body.style.overflow = '';
    }

    const closeBtn = lightbox.querySelector('.lightbox-close');
    if (closeBtn) closeBtn.addEventListener('click', closeLightbox);

    const prevBtn = lightbox.querySelector('.lightbox-prev');
    const nextBtn = lightbox.querySelector('.lightbox-next');

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        currentLightboxIndex = (currentLightboxIndex - 1 + lightboxImages.length) % lightboxImages.length;
        openLightbox(currentLightboxIndex);
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        currentLightboxIndex = (currentLightboxIndex + 1) % lightboxImages.length;
        openLightbox(currentLightboxIndex);
      });
    }

    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox) closeLightbox();
    });

    document.addEventListener('keydown', (e) => {
      if (!lightbox.classList.contains('open')) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') prevBtn && prevBtn.click();
      if (e.key === 'ArrowRight') nextBtn && nextBtn.click();
    });
  }

  // ===== CONTACT FORM =====
  const contactForm = document.getElementById('contactForm');
  if (contactForm) {
    contactForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = contactForm.querySelector('[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'Sending...';

      try {
        const data = Object.fromEntries(new FormData(contactForm));
        const res = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        const json = await res.json();
        if (json.success) {
          contactForm.innerHTML = `
            <div style="text-align:center;padding:3rem 1rem;">
              <div style="width:60px;height:60px;background:rgba(184,150,78,0.1);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 1.5rem;font-size:1.5rem;color:#b8964e;">✓</div>
              <h3 style="font-family:'Cormorant Garamond',serif;font-size:1.8rem;color:#0d1b2a;margin-bottom:1rem;">Message Received</h3>
              <p style="font-size:0.88rem;color:#4a4a5a;line-height:1.8;">Thank you for reaching out. Our team will respond within 24 hours.</p>
            </div>`;
        }
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Send Message';
        alert('An error occurred. Please try again or call us directly.');
      }
    });
  }

  // ===== RESERVATION FORM =====
  const reservationForm = document.getElementById('reservationForm');
  const successOverlay = document.querySelector('.success-overlay');

  if (reservationForm) {
    // Dynamic price calculation
    const checkinInput = document.getElementById('checkin');
    const checkoutInput = document.getElementById('checkout');
    const roomSelect = document.getElementById('room');
    const priceDisplay = document.getElementById('totalPrice');
    const nightsDisplay = document.getElementById('nightsDisplay');
    const roomPriceDisplay = document.getElementById('roomPriceDisplay');
    const taxDisplay = document.getElementById('taxDisplay');

    const roomPrices = {
      'tiburon-bay-suite': 695,
      'marin-sanctuary': 595,
      'golden-gate-vista': 795,
      'alcatraz-suite': 650,
      'captains-quarters': 550,
      'hillside-retreat': 525,
      'marina-room': 575,
      'garden-bower': 495
    };

    function updatePrice() {
      if (!checkinInput || !checkoutInput || !roomSelect) return;
      const checkin = new Date(checkinInput.value);
      const checkout = new Date(checkoutInput.value);
      const room = roomSelect.value;
      
      if (!checkinInput.value || !checkoutInput.value || !room) return;
      
      const nights = Math.ceil((checkout - checkin) / (1000 * 60 * 60 * 24));
      if (nights <= 0) return;
      
      const rate = roomPrices[room] || 595;
      const subtotal = rate * nights;
      const tax = Math.round(subtotal * 0.12);
      const total = subtotal + tax;
      
      if (nightsDisplay) nightsDisplay.textContent = nights + (nights === 1 ? ' Night' : ' Nights');
      if (roomPriceDisplay) roomPriceDisplay.textContent = '$' + rate + ' × ' + nights;
      if (taxDisplay) taxDisplay.textContent = '$' + tax;
      if (priceDisplay) priceDisplay.textContent = '$' + total.toLocaleString();
    }

    [checkinInput, checkoutInput, roomSelect].forEach(el => {
      if (el) el.addEventListener('change', updatePrice);
    });

    // Set min dates
    const today = new Date().toISOString().split('T')[0];
    if (checkinInput) {
      checkinInput.min = today;
      checkinInput.addEventListener('change', () => {
        const next = new Date(checkinInput.value);
        next.setDate(next.getDate() + 1);
        if (checkoutInput) checkoutInput.min = next.toISOString().split('T')[0];
      });
    }

    reservationForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = reservationForm.querySelector('[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'Processing...';

      try {
        const data = Object.fromEntries(new FormData(reservationForm));
        const res = await fetch('/api/reservation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        const json = await res.json();
        if (json.success) {
          const confEl = document.getElementById('confirmationNumber');
          if (confEl) confEl.textContent = 'Confirmation #: ' + json.confirmation;
          if (successOverlay) successOverlay.classList.add('show');
          document.body.style.overflow = 'hidden';
        } else {
          alert(json.message || 'Please check all fields and try again.');
          btn.disabled = false;
          btn.textContent = 'Complete Reservation';
        }
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Complete Reservation';
        alert('An error occurred. Please try again.');
      }
    });
  }

  // Close success overlay
  const successClose = document.getElementById('successClose');
  if (successClose && successOverlay) {
    successClose.addEventListener('click', () => {
      successOverlay.classList.remove('show');
      document.body.style.overflow = '';
      window.location.href = '/';
    });
  }

  // ===== PARALLAX =====
  const pageHero = document.querySelector('.page-hero');
  if (pageHero) {
    window.addEventListener('scroll', () => {
      const scrolled = window.scrollY;
      pageHero.style.backgroundPositionY = `calc(center + ${scrolled * 0.3}px)`;
    });
  }

});
