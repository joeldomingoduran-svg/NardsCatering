
window.addEventListener('scroll', () => {
const nav = document.querySelector('nav');
nav.style.background = window.scrollY > 50
? 'rgba(36,24,18,0.98)'
: 'rgba(36,24,18,0.85)';
});


const sections = document.querySelectorAll('section');
const navLinks = document.querySelectorAll('.nav-links a');

window.addEventListener('scroll', () => {
let current = '';
sections.forEach(section => {
if (window.scrollY >= section.offsetTop - 120) {
current = section.getAttribute('id');
}
});
navLinks.forEach(link => {
link.style.color = link.getAttribute('href') === `#${current}`
? '#c8a25a'
: '';
});
});


const fadeEls = document.querySelectorAll(
'.hero-left, .hero-img-wrapper, .section-inner, .offer-card, .offer-row'
);

const observer = new IntersectionObserver((entries) => {
entries.forEach(entry => {
if (entry.isIntersecting) {
entry.target.style.opacity = '1';
entry.target.style.transform = 'translateY(0)';
observer.unobserve(entry.target);
}
});
}, { threshold: 0.15 });

fadeEls.forEach(el => {
el.style.opacity = '0';
el.style.transform = 'translateY(30px)';
el.style.transition = 'opacity 0.7s ease, transform 0.7s ease';
observer.observe(el);
});


document.querySelectorAll('.nav-cta, .big-btn').forEach(btn => {
btn.addEventListener('click', () => {
document.querySelector('#contact').scrollIntoView({ behavior: 'smooth' });
});
});


document.querySelectorAll('.offer-card').forEach((card, i) => {
card.style.transitionDelay = `${i * 0.08}s`;
});


const heroImg = document.querySelector('.hero-img-wrapper');
if (heroImg) {
document.addEventListener('mousemove', (e) => {
const x = (e.clientX / window.innerWidth - 0.5) * 12;
const y = (e.clientY / window.innerHeight - 0.5) * 12;
heroImg.style.transform = `translate(${x}px, ${y}px)`;
});
}


const footer = document.querySelector('footer');
if (footer) {
footer.innerHTML = `© ${new Date().getFullYear()} Nards Catering`;
}