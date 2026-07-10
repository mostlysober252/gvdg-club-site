import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

test('homepage feeds are rendered by the home React bundle', () => {
  const html = readFileSync('index.html', 'utf8');
  const packageJson = readFileSync('package.json', 'utf8');

  assert.match(packageJson, /"build:home": "vite build --config vite\.home\.config\.mjs"/);
  assert.match(packageJson, /"build": "npm run build:home && npm run build:public && npm run build:admin && npm run build:tee-sign-preview && npm run build:score && npm run build:members"/);
  assert.ok(existsSync('vite.home.config.mjs'));
  assert.equal(existsSync('home-feeds.js'), false);
  assert.equal(existsSync('home-feed-parse.js'), false);
  assert.match(html, /id="homeReactEventsApp"/);
  assert.match(html, /id="homeReactTournamentsApp"/);
  assert.match(html, /<div id="homeReactEventsApp"><\/div>/);
  assert.match(html, /<div id="homeReactTournamentsApp"><\/div>/);
  assert.match(html, /<script type="module" src="home-app\/home-app\.js"><\/script>/);
  assert.doesNotMatch(html, /<script type="module" src="home-feeds\.js"><\/script>/);
  assert.doesNotMatch(html, /<div id="homeReactEventsApp"><div class="event-list">/);
  assert.doesNotMatch(html, /<div id="homeReactTournamentsApp"><div class="tournament-list">/);
  assert.doesNotMatch(html, /<p>Loading events\.\.\.<\/p>|<p>Loading tournaments\.\.\.<\/p>/);
});

test('home React feed components own events and tournaments without DOM fallbacks', () => {
  const main = readFileSync('src/home-app/main.js', 'utf8');
  const panels = readFileSync('src/home-app/feed-panels.js', 'utf8');

  assert.match(main, /createRoot\(eventsMount\)\.render\(h\(HomeEventsFeed\)\)/);
  assert.match(main, /createRoot\(tournamentsMount\)\.render\(h\(AreaTournamentsFeed\)\)/);
  assert.match(panels, /export function HomeEventsFeed/);
  assert.match(panels, /export function AreaTournamentsFeed/);
  assert.match(panels, /data-react-home-events/);
  assert.match(panels, /data-react-home-tournaments/);
  assert.match(panels, /safeExternalUrl/);
  assert.match(panels, /ChevronDown/);
  assert.match(panels, /MapPin/);
  assert.doesNotMatch(panels, /document\.|innerHTML|insertAdjacentHTML|replaceChildren|document\.createElement/);
  assert.doesNotMatch(panels, /📍|🏆|🥏/);
});

test('home React bundle owns the course modal instead of inline DOM injection', () => {
  const html = readFileSync('index.html', 'utf8');
  const main = readFileSync('src/home-app/main.js', 'utf8');
  const courseModal = readFileSync('src/home-app/course-modal.js', 'utf8');

  assert.match(html, /id="homeReactCourseModalApp"/);
  assert.doesNotMatch(html, /insertAdjacentHTML\('beforeend',mh\)|modalCourseName|modalUdisc|modalDirections|modalYoutube|id="courseModal"/);
  assert.match(main, /createRoot\(courseModalMount\)\.render\(h\(CourseModal\)\)/);
  assert.match(courseModal, /export function CourseModal/);
  assert.match(courseModal, /data-react-course-modal/);
  assert.match(courseModal, /role: "dialog"/);
  assert.match(courseModal, /aria-disabled/);
  assert.match(courseModal, /safeExternalUrl/);
  assert.match(courseModal, /MapPin/);
  assert.match(courseModal, /Navigation/);
  assert.doesNotMatch(courseModal, /innerHTML|insertAdjacentHTML|document\.createElement|replaceChildren|modalCourseName|modalUdisc|modalDirections|modalYoutube/);
  assert.doesNotMatch(courseModal, /📍|▶|→/);
});

test('home React bundle owns the course carousel cards', () => {
  const html = readFileSync('index.html', 'utf8');
  const main = readFileSync('src/home-app/main.js', 'utf8');
  const courses = readFileSync('src/home-app/courses-app.js', 'utf8');
  const courseModal = readFileSync('src/home-app/course-modal.js', 'utf8');

  assert.match(html, /<section id="courses">[\s\S]*id="homeReactCoursesApp"[\s\S]*<\/section>/);
  assert.doesNotMatch(html, /<div class="course-card"/);
  assert.doesNotMatch(html, /data-course="ECU North Rec Complex"/);
  assert.match(main, /import \{ HomeCoursesApp \} from "\.\/courses-app\.js"/);
  assert.match(main, /const coursesMount = document\.getElementById\("homeReactCoursesApp"\)/);
  assert.match(main, /createRoot\(coursesMount\)\.render\(h\(HomeCoursesApp\)\)/);
  assert.match(courses, /export function HomeCoursesApp/);
  assert.match(courses, /data-react-home-courses/);
  assert.match(courses, /COURSE_SLIDES/);
  assert.match(courses, /className: "course-card"/);
  assert.match(courses, /"data-course": course\.course/);
  assert.match(courses, /role: "button"/);
  assert.match(courses, /tabIndex: 0/);
  assert.match(courses, /MapPin/);
  assert.match(courses, /Disc3/);
  assert.match(courseModal, /closest\("\.course-card\[data-course\]"\)/);
  assert.doesNotMatch(courses, /document\.|innerHTML|insertAdjacentHTML|replaceChildren|document\.createElement|querySelector|classList|textContent\s*=/);
  assert.doesNotMatch(courses, /📍|🥏|‹|›/);
});

test('home React bundle owns membership contact and footer sections', () => {
  const html = readFileSync('index.html', 'utf8');
  const main = readFileSync('src/home-app/main.js', 'utf8');
  const community = readFileSync('src/home-app/community-sections.js', 'utf8');

  assert.match(html, /<section id="membership">[\s\S]*id="homeReactMembershipApp"[\s\S]*<\/section>/);
  assert.match(html, /<section id="contact">[\s\S]*id="homeReactContactApp"[\s\S]*<\/section>/);
  assert.match(html, /id="homeReactFooterApp"/);
  assert.doesNotMatch(html, /class="membership-content"|class="membership-perks"|class="contact-box"|<footer><p>&copy;/);
  assert.doesNotMatch(html, /🏆|💬|🎯|📊|📧|📱|📍/);
  assert.match(main, /import \{ HomeContactSection, HomeFooter, HomeMembershipSection \} from "\.\/community-sections\.js"/);
  assert.match(main, /createRoot\(membershipMount\)\.render\(h\(HomeMembershipSection\)\)/);
  assert.match(main, /createRoot\(contactMount\)\.render\(h\(HomeContactSection\)\)/);
  assert.match(main, /createRoot\(footerMount\)\.render\(h\(HomeFooter\)\)/);
  assert.match(community, /export function HomeMembershipSection/);
  assert.match(community, /export function HomeContactSection/);
  assert.match(community, /export function HomeFooter/);
  assert.match(community, /data-react-home-membership/);
  assert.match(community, /data-react-home-contact/);
  assert.match(community, /data-react-home-footer/);
  assert.match(community, /safeExternalUrl/);
  assert.match(community, /Trophy/);
  assert.match(community, /MessageCircle/);
  assert.match(community, /Target/);
  assert.match(community, /ChartNoAxesColumnIncreasing/);
  assert.match(community, /Mail/);
  assert.match(community, /Smartphone/);
  assert.match(community, /MapPin/);
  assert.match(community, /mailto:greenvillediscgolf@gmail\.com/);
  assert.doesNotMatch(community, /document\.|innerHTML|insertAdjacentHTML|replaceChildren|document\.createElement|querySelector|classList|textContent\s*=/);
  assert.doesNotMatch(community, /🏆|💬|🎯|📊|📧|📱|📍|&copy;/);
});

test('home React bundle owns hero and about carousel sections', () => {
  const html = readFileSync('index.html', 'utf8');
  const main = readFileSync('src/home-app/main.js', 'utf8');
  const heroAbout = readFileSync('src/home-app/hero-about-app.js', 'utf8');
  const bodyMarkup = html.slice(html.indexOf('<body'));

  assert.match(html, /id="homeReactHeroApp"/);
  assert.match(html, /<section id="about">[\s\S]*id="homeReactAboutApp"[\s\S]*<\/section>/);
  assert.doesNotMatch(bodyMarkup, /<section class="hero"|class="hero-content"|class="about-carousel-container"|board-member-icon|🥏|💰|‹|›/);
  assert.match(main, /import \{ HomeAboutSection, HomeHeroSection \} from "\.\/hero-about-app\.js"/);
  assert.match(main, /createRoot\(heroMount\)\.render\(h\(HomeHeroSection\)\)/);
  assert.match(main, /createRoot\(aboutMount\)\.render\(h\(HomeAboutSection\)\)/);
  assert.match(heroAbout, /export function HomeHeroSection/);
  assert.match(heroAbout, /export function HomeAboutSection/);
  assert.match(heroAbout, /data-react-home-hero/);
  assert.match(heroAbout, /data-react-home-about/);
  assert.match(heroAbout, /nextCircularIndex/);
  assert.match(heroAbout, /window\.setInterval/);
  assert.match(heroAbout, /onMouseEnter: \(\) => setPaused\(true\)/);
  assert.match(heroAbout, /useSwipe/);
  assert.match(heroAbout, /useAnimatedCount/);
  assert.match(heroAbout, /style: \{ transform: `translateX\(-\$\{current \* 100\}%\)` \}/);
  assert.match(heroAbout, /className: "carousel-slide-about"/);
  assert.match(heroAbout, /ChevronLeft/);
  assert.match(heroAbout, /ChevronRight/);
  assert.match(heroAbout, /Disc3/);
  assert.match(heroAbout, /CircleDollarSign/);
  assert.doesNotMatch(heroAbout, /document\.|innerHTML|insertAdjacentHTML|replaceChildren|document\.createElement|querySelector|classList|textContent\s*=|data-count/);
  assert.doesNotMatch(heroAbout, /🥏|💰|‹|›/);
});

test('home React bundle owns theme and back-to-top controls', () => {
  const html = readFileSync('index.html', 'utf8');
  const main = readFileSync('src/home-app/main.js', 'utf8');
  const controls = readFileSync('src/home-app/page-controls.js', 'utf8');

  assert.match(html, /id="homeReactBackToTopApp"/);
  assert.match(html, /\.back-to-top\s*\{[^}]*display:\s*flex/);
  assert.doesNotMatch(html, /\.back-to-top\s*\{[^}]*display:\s*none/);
  assert.doesNotMatch(html, /homeReactThemeToggleApp|class="theme-icon"|id="backToTop"|themeIcon\.textContent|getElementById\('backToTop'\)/);
  assert.doesNotMatch(main, /themeToggleMount/);
  assert.match(main, /createRoot\(backToTopMount\)\.render\(h\(HomeBackToTop\)\)/);
  assert.match(controls, /export function HomeThemeToggle/);
  assert.match(controls, /export function HomeBackToTop/);
  assert.match(controls, /aria-pressed/);
  assert.match(controls, /localStorage\.setItem\("theme", theme\)/);
  assert.match(controls, /window\.scrollTo\(\{ top: 0, behavior: "smooth" \}\)/);
  assert.match(controls, /MoonStar/);
  assert.match(controls, /Sun/);
  assert.match(controls, /ArrowUp/);
  assert.doesNotMatch(controls, /innerHTML|insertAdjacentHTML|document\.createElement|replaceChildren|themeIcon|backToTop|☀️|🌙|↑/);
});

test('home React bundle owns page chrome menu and header scroll state', () => {
  const html = readFileSync('index.html', 'utf8');
  const main = readFileSync('src/home-app/main.js', 'utf8');
  const chrome = readFileSync('src/home-app/page-chrome.js', 'utf8');

  assert.match(html, /id="homeReactPageChromeApp"/);
  assert.doesNotMatch(html, /<script src="nav\.js"|class="menu-toggle" aria-label="Toggle menu"|const menuToggle=|const header=document\.querySelector\('header'\)/);
  assert.match(main, /createRoot\(pageChromeMount\)\.render\(h\(HomePageChrome\)\)/);
  assert.match(chrome, /export function HomePageChrome/);
  assert.match(chrome, /data-react-home-chrome/);
  assert.match(chrome, /aria-expanded/);
  assert.match(chrome, /aria-current/);
  assert.match(chrome, /nav-donate/);
  assert.match(chrome, /HomeThemeToggle/);
  assert.match(chrome, /Menu, X/);
  assert.match(chrome, /window\.requestAnimationFrame\(update\)/);
  assert.doesNotMatch(chrome, /querySelector|classList|textContent\s*=|☰|✕|🌙|☀️/);
});

test('home React components own remaining homepage interactions without a selector controller', () => {
  const html = readFileSync('index.html', 'utf8');
  const main = readFileSync('src/home-app/main.js', 'utf8');
  const heroAbout = readFileSync('src/home-app/hero-about-app.js', 'utf8');
  const courses = readFileSync('src/home-app/courses-app.js', 'utf8');
  const community = readFileSync('src/home-app/community-sections.js', 'utf8');
  const hooks = readFileSync('src/home-app/interaction-hooks.js', 'utf8');

  assert.ok(!existsSync('src/home-app/page-interactions.js'));
  assert.doesNotMatch(html, /id="homeReactInteractionsApp"|let currentSlide=|new IntersectionObserver|document\.querySelectorAll\('a\[href\^="#"]/);
  assert.doesNotMatch(main, /HomePageInteractions|page-interactions|interactionsMount|homeReactInteractionsApp/);
  assert.match(html, /html \{ scroll-behavior: smooth; \}/);
  assert.match(heroAbout, /window\.setInterval/);
  assert.match(heroAbout, /useAnimatedCount/);
  assert.match(heroAbout, /useRevealOnce/);
  assert.match(courses, /React\.useLayoutEffect/);
  assert.match(courses, /style: \{ transform: `translateX\(-\$\{current \* 100\}%\)` \}/);
  assert.match(community, /useRevealOnce/);
  assert.match(hooks, /export function useSwipe/);
  assert.match(hooks, /export function useRevealOnce/);
  assert.match(hooks, /export function useAnimatedCount/);
  assert.doesNotMatch(hooks, /innerHTML|insertAdjacentHTML|replaceChildren|document\.createElement|querySelector|classList|textContent\s*=|☰|✕|🌙|☀️|↑/);
});
