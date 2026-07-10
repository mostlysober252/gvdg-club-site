import React from "react";
import { ChevronLeft, ChevronRight, Disc3, MapPin } from "lucide-react";

import { safeExternalUrl } from "../shared/safe-url.js";
import { clampedIndex, useSwipe } from "./interaction-hooks.js";

const h = React.createElement;

const COURSE_SLIDES = [
  {
    title: "Our Courses",
    subtitle: "5 Courses in Greenville, NC",
    courses: [
      {
        course: "ECU North Rec Complex",
        name: "ECU North Rec Complex",
        location: "Greenville, NC",
        udisc: "https://udisc.com/courses/ecu-north-recreational-complex-HbME",
        coords: "35.631092,-77.319923",
        image: "https://d22ksth68ujgu2.cloudfront.net/b7fd828f4c6bf4fe89cd95a2d07e4cfc_m_IMG_6470.jpg",
        imageAlt: "ECU North Recreational Complex",
        difficultyClass: "difficulty-intermediate",
        difficulty: "Moderate - Hard",
        holes: "23",
        rating: "4.4",
        time: "~2 hrs",
        description: "Well-maintained course with manicured fairways and great signage.",
      },
      {
        course: "West Meadowbrook Park",
        name: "West Meadowbrook Park",
        location: "Greenville, NC",
        udisc: "https://udisc.com/courses/west-meadowbrook-park-40Aw",
        coords: "35.6264,-77.375",
        image: "https://d22ksth68ujgu2.cloudfront.net/a280319675d856e30869b9bca4eaee00_m_40698704_Unknown.jpg",
        imageAlt: "West Meadowbrook Park",
        difficultyClass: "difficulty-beginner",
        difficulty: "Easy - Hard",
        holes: "18",
        rating: "4.3",
        time: "~1 hr",
        description: "Five layouts available! Great mix of open and wooded shots.",
      },
      {
        course: "Covenant Church",
        name: "Covenant Church",
        location: "Winterville, NC",
        udisc: "https://udisc.com/courses/covenant-church-Kbtz",
        coords: "35.55785,-77.360886",
        image: "https://d22ksth68ujgu2.cloudfront.net/8342d5e6d680264501f3f46c96b61755_m_IMG_1449.jpg",
        imageAlt: "Covenant Church",
        difficultyClass: "difficulty-intermediate",
        difficulty: "Moderate",
        holes: "18",
        rating: "4.3",
        time: "~1 hr",
        description: "Challenging wooded course with water holes and tight lines.",
      },
      {
        course: "The Oakwood Eagles' Nest",
        name: "The Oakwood Eagles' Nest",
        location: "Greenville, NC",
        udisc: "https://udisc.com/courses/the-oakwood-eagles-nest-TGSv",
        coords: "35.621615,-77.448291",
        difficultyClass: "difficulty-intermediate",
        difficulty: "Moderate",
        holes: "18",
        rating: "4.0",
        time: "~1.5 hrs",
        description: "School campus course with cart-friendly paths.",
      },
      {
        course: "Third Street Disc Golf",
        name: "Third Street Disc Golf",
        location: "Greenville, NC",
        udisc: "https://udisc.com/courses/third-street-disc-golf-EC96",
        coords: "35.5931,-77.3847",
        image: "https://d22ksth68ujgu2.cloudfront.net/658645982c2779bbc89dbe41fa1de4c7_m_IMG_6254.jpg",
        imageAlt: "Third Street Disc Golf",
        difficultyClass: "difficulty-intermediate",
        difficulty: "Moderate",
        holes: "9",
        rating: "3.7",
        time: "~30 min",
        description: "Quick 9-hole course perfect for a fast round.",
      },
    ],
  },
  {
    title: "Nearby Courses",
    subtitle: "7 Courses Within 30 Minutes of Greenville",
    courses: [
      {
        course: "Farmville DiscGolfPark",
        name: "Farmville DiscGolfPark",
        location: "Farmville, NC",
        distance: "15 min",
        udisc: "https://udisc.com/courses/farmville-disc-golf-park-YCBv",
        coords: "35.604686,-77.576533",
        image: "https://d22ksth68ujgu2.cloudfront.net/decd19215d15e33dad293d8b394eaca8_m_IMG_5046.jpg",
        imageAlt: "Farmville DiscGolfPark",
        difficultyClass: "difficulty-intermediate",
        difficulty: "Moderate",
        holes: "18",
        rating: "4.3",
        time: "~1.5 hrs",
        description: "Former farmland with woods, Blue and Red tee pads available.",
      },
      {
        course: "Ayden Park",
        name: "Ayden Park",
        location: "Ayden, NC",
        distance: "20 min",
        udisc: "https://udisc.com/courses/ayden-park-HoPq",
        coords: "35.489203,-77.426836",
        image: "https://d22ksth68ujgu2.cloudfront.net/6e443673f3aae14b699bfbef1c94b75a_m_IMG_2887.jpg",
        imageAlt: "Ayden Park",
        difficultyClass: "difficulty-intermediate",
        difficulty: "Moderate",
        holes: "18",
        rating: "3.5",
        time: "~2 hrs",
        description: "Fun beginner-friendly open course in a public park.",
      },
      {
        course: "Barnet Park",
        name: "Barnet Park",
        location: "Kinston, NC",
        distance: "30 min",
        udisc: "https://udisc.com/courses/barnet-park-kDCh",
        coords: "35.278801,-77.640503",
        image: "https://d22ksth68ujgu2.cloudfront.net/ce27baa0cd58600da35e54beb76128c1_m_IMG_2170.jpg",
        imageAlt: "Barnet Park",
        difficultyClass: "difficulty-advanced",
        difficulty: "Moderate - Very Hard",
        holes: "18",
        rating: "4.1",
        time: "~1.5 hrs",
        description: "Classic eastern NC wooded course with technical shots.",
      },
      {
        course: "Beaufort County CC",
        name: "Beaufort County CC",
        location: "Washington, NC",
        distance: "25 min",
        udisc: "https://udisc.com/courses/beaufort-county-community-college-ijIj",
        coords: "35.5549,-77.0152",
        image: "https://d22ksth68ujgu2.cloudfront.net/024cd11e84bcdf7863ec22e4876a4e4f_m_IMG_0395.jpg",
        imageAlt: "Beaufort County Community College",
        difficultyClass: "difficulty-intermediate",
        difficulty: "Moderate",
        holes: "18",
        rating: "3.8",
        time: "~2 hrs",
        description: "College campus course with elevation and water hazards.",
      },
      {
        course: "Farm Life Disc Golf",
        name: "Farm Life Disc Golf",
        location: "Williamston, NC",
        distance: "30 min",
        udisc: "https://udisc.com/courses/farm-life-disc-golf-3IvE",
        coords: "35.7416,-76.985603",
        image: "https://d22ksth68ujgu2.cloudfront.net/dc17882950ff11c0a7a2ee7a14438cf5_m_IMG_7564.jpg",
        imageAlt: "Farm Life Disc Golf",
        difficultyClass: "difficulty-intermediate",
        difficulty: "Moderate",
        holes: "18",
        rating: "4.5",
        time: "~2 hrs",
        description: "Highly-rated scenic private course worth the drive.",
      },
      {
        course: "Snipers Landing at Robersonville CC",
        name: "Snipers Landing",
        location: "Robersonville, NC",
        distance: "25 min",
        udisc: "https://udisc.com/courses/snipers-landing-at-robersonville-cc-0WKq",
        coords: "35.861996,-77.244241",
        image: "https://imagedelivery.net/gSwsyfyonEyXxR24Q80qjQ/c5986195-9aae-45d0-3a31-8f4a5a889900/public",
        imageAlt: "Snipers Landing at Robersonville CC",
        difficultyClass: "difficulty-advanced",
        difficulty: "Hard",
        holes: "18",
        rating: "4.3",
        time: "~2.5 hrs",
        description: "$10 greens fee. 3 tee sets on a ball golf course. Check in at pro shop.",
      },
      {
        course: "Ayden-Grifton HS Disc Golf Course",
        name: "Ayden-Grifton HS DGC",
        location: "Ayden, NC",
        distance: "20 min",
        udisc: "https://udisc.com/courses/ayden-grifton-hs-disc-golf-course-sLFk",
        coords: "35.429322,-77.431738",
        difficultyClass: "difficulty-beginner",
        difficulty: "Easy",
        holes: "9",
        rating: "New",
        time: "~30 min",
        description: "Beginner-friendly school course. Weekdays after 5pm, weekends sunrise-sunset.",
      },
    ],
  },
  {
    title: "Worth The Drive",
    subtitle: "10 Top-Rated Courses Within 60 Miles",
    courses: [
      {
        course: "Glenburnie Park",
        name: "Glenburnie Park",
        location: "New Bern, NC",
        distance: "45 min",
        udisc: "https://udisc.com/courses/glenburnie-park-Rsnq",
        coords: "35.138901,-77.061699",
        image: "https://d22ksth68ujgu2.cloudfront.net/20348b2697a1d34ef46a457ea19fb677_m_IMG_2080.jpg",
        imageAlt: "Glenburnie Park",
        difficultyClass: "difficulty-advanced",
        difficulty: "Moderate - Hard",
        holes: "18",
        rating: "4.6",
        time: "~2 hrs",
        description: "One of the best in Eastern NC with river views and elevation.",
      },
      {
        course: "Creekside Park",
        name: "Creekside Park",
        location: "New Bern, NC",
        distance: "50 min",
        udisc: "https://udisc.com/courses/creekside-park-GaFZ",
        coords: "35.061508,-77.044464",
        image: "https://d22ksth68ujgu2.cloudfront.net/1d99b20a6b23ab7bd5fc96edb0272862_m_IMG_0370.jpg",
        imageAlt: "Creekside Park",
        difficultyClass: "difficulty-advanced",
        difficulty: "Moderate - Hard",
        holes: "18",
        rating: "4.3",
        time: "~2 hrs",
        description: "Technical wooded course with excellent amenities.",
      },
      {
        course: "Sunset Park DGC",
        name: "Sunset Park DGC",
        location: "Rocky Mount, NC",
        distance: "50 min",
        udisc: "https://udisc.com/courses/sunset-park-dgc-Z1wS",
        coords: "35.953166,-77.813380",
        image: "https://d22ksth68ujgu2.cloudfront.net/e3547497c0aae8f215a1680d4080f1f0_m_IMG_5628.jpg",
        imageAlt: "Sunset Park DGC",
        difficultyClass: "difficulty-advanced",
        difficulty: "Moderate - Hard",
        holes: "18",
        rating: "4.1",
        time: "~2 hrs",
        description: "Well-established course in a beautiful park setting.",
      },
      {
        course: "Battle Park DGC",
        name: "Battle Park DGC",
        location: "Rocky Mount, NC",
        distance: "50 min",
        udisc: "https://udisc.com/courses/battle-park-dgc-XD3h",
        coords: "35.961804,-77.804932",
        image: "https://d22ksth68ujgu2.cloudfront.net/afbccd3914ebea747a7f303b5770ca05_m_IMG_5571.jpg",
        imageAlt: "Battle Park DGC",
        difficultyClass: "difficulty-advanced",
        difficulty: "Hard",
        holes: "18",
        rating: "4.0",
        time: "~2 hrs",
        description: "Newest Rocky Mount course with woods and river in play.",
      },
      {
        course: "Richlands-Steed Park",
        name: "Richlands-Steed Park",
        location: "Richlands, NC",
        distance: "55 min",
        udisc: "https://udisc.com/courses/richlands-steed-park-MaGt",
        coords: "34.897999,-77.522202",
        image: "https://d22ksth68ujgu2.cloudfront.net/c8d3da5095beedd83e85fbdb67c4bce6_m_IMG_9398.jpg",
        imageAlt: "Richlands-Steed Park",
        difficultyClass: "difficulty-beginner",
        difficulty: "Beginner Friendly",
        holes: "21",
        rating: "4.3",
        time: "~1.5 hrs",
        description: "Great beginner course, well-maintained with open fairways.",
      },
      {
        course: "Eagles Apex at West Craven Park",
        name: "Eagles Apex at West Craven",
        location: "New Bern, NC",
        distance: "50 min",
        udisc: "https://udisc.com/courses/eagles-apex-at-west-craven-park-9saH",
        coords: "35.232019,-77.132066",
        difficultyClass: "difficulty-advanced",
        difficulty: "Moderate - Very Hard",
        holes: "18",
        rating: "4.0",
        time: "~2 hrs",
        description: "Newer course with short and long layouts. Free to play.",
      },
      {
        course: "NC Wesleyan University",
        name: "NC Wesleyan University",
        location: "Rocky Mount, NC",
        distance: "55 min",
        udisc: "https://udisc.com/courses/north-carolina-wesleyan-university-Xw47",
        coords: "35.936,-77.833",
        difficultyClass: "difficulty-intermediate",
        difficulty: "Moderate",
        holes: "20",
        rating: "4.3",
        time: "~1.5 hrs",
        description: "Redesigned 2023. Campus course with disc store and PDGA events.",
      },
      {
        course: "Nash Community College DGC",
        name: "Nash Community College DGC",
        location: "Rocky Mount, NC",
        distance: "55 min",
        udisc: "https://udisc.com/courses/nash-community-college-dgc-fGpR",
        coords: "35.977,-77.863",
        difficultyClass: "difficulty-advanced",
        difficulty: "Hard",
        holes: "18",
        rating: "4.2",
        time: "~2 hrs",
        description: "Open and wooded mix with water carries. Best played off-peak hours.",
      },
      {
        course: "Farmington Park DGC",
        name: "Farmington Park DGC",
        location: "Rocky Mount, NC",
        distance: "50 min",
        udisc: "https://udisc.com/courses/farmington-park-dgc-xQw3",
        coords: "35.946,-77.838",
        difficultyClass: "difficulty-intermediate",
        difficulty: "Moderate",
        holes: "18",
        rating: "3.9",
        time: "~1.5 hrs",
        description: "Active league play with Flexing on Farm Fridays.",
      },
      {
        course: "Northeast Creek Park",
        name: "Northeast Creek Park",
        location: "Jacksonville, NC",
        distance: "60 min",
        udisc: "https://udisc.com/courses/northeast-creek-park-UIAe",
        coords: "34.747051,-77.358165",
        difficultyClass: "difficulty-advanced",
        difficulty: "Moderate - Hard",
        holes: "18",
        rating: "4.4",
        time: "~2 hrs",
        description: "Jacksonville's top course. Well-groomed with coastal winds adding challenge.",
      },
    ],
  },
];

function icon(Icon, props = {}) {
  return h(Icon, {
    ...props,
    "aria-hidden": "true",
    focusable: "false",
    size: props.size || 18,
    strokeWidth: props.strokeWidth || 2.4,
  });
}

function handleCardKeyDown(event) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  event.currentTarget.click();
}

function SlideArrow({ direction, disabled, onClick }) {
  const previous = direction === "previous";
  return h(
    "button",
    {
      className: "slide-nav-arrow " + (previous ? "slide-nav-prev" : "slide-nav-next"),
      disabled,
      onClick,
      type: "button",
      "aria-label": previous ? "Previous courses slide" : "Next courses slide",
    },
    icon(previous ? ChevronLeft : ChevronRight, { size: 22 }),
  );
}

function CourseImage({ course }) {
  const image = safeExternalUrl(course.image || "");
  return h(
    "div",
    { className: "course-image" + (image ? "" : " no-image") },
    image
      ? h("img", { src: image, alt: course.imageAlt || course.name, loading: "lazy" })
      : icon(Disc3, { className: "course-placeholder-icon", size: 64, strokeWidth: 1.8 }),
  );
}

function InfoItem({ label, value }) {
  return h("div", { className: "info-item" }, [
    h("div", { className: "info-label", key: "label" }, label),
    h("div", { className: "info-value", key: "value" }, value),
  ]);
}

function CourseCard({ course }) {
  const visibleLocation = course.distance ? `${course.location} - ${course.distance}` : course.location;
  return h(
    "div",
    {
      className: "course-card",
      role: "button",
      tabIndex: 0,
      "aria-label": `${course.name}, ${visibleLocation}. Open course options.`,
      "data-course": course.course,
      "data-location": course.location,
      "data-udisc": safeExternalUrl(course.udisc || ""),
      "data-coords": course.coords || "",
      "data-youtube": safeExternalUrl(course.youtube || ""),
      onKeyDown: handleCardKeyDown,
    },
    [
      h(CourseImage, { course, key: "image" }),
      h("div", { className: "course-content", key: "content" }, [
        h("div", { className: "course-header", key: "header" }, [
          h("h3", { className: "course-name", key: "name" }, course.name),
          h("span", { className: `difficulty-badge ${course.difficultyClass}`, key: "difficulty" }, course.difficulty),
        ]),
        h("div", { className: "course-location", key: "location" }, [
          icon(MapPin, { key: "icon", size: 14 }),
          h("span", { key: "text" }, visibleLocation),
        ]),
        h("div", { className: "course-info", key: "info" }, [
          h(InfoItem, { label: "Holes", value: course.holes, key: "holes" }),
          h(InfoItem, { label: "Rating", value: course.rating, key: "rating" }),
          h(InfoItem, { label: "Time", value: course.time, key: "time" }),
        ]),
        h("p", { className: "course-description", key: "description" }, course.description),
      ]),
    ],
  );
}

function CourseSlide({ active, onNext, onPrevious, onSizeChange, slide, slideRef }) {
  return h("div", { className: "carousel-slide-courses", onLoadCapture: onSizeChange, ref: slideRef }, [
    h("div", { className: "slide-header-nav", key: "header-nav" }, [
      h(SlideArrow, { direction: "previous", disabled: !active || onPrevious == null, key: "previous", onClick: onPrevious }),
      h("div", { className: "slide-header", key: "header" }, [
        h("h3", { className: "slide-title", key: "title" }, slide.title),
        h("p", { className: "slide-subtitle", key: "subtitle" }, slide.subtitle),
      ]),
      h(SlideArrow, { direction: "next", disabled: !active || onNext == null, key: "next", onClick: onNext }),
    ]),
    h("div", { className: "courses-grid", key: "grid" }, slide.courses.map((course) => h(CourseCard, { course, key: course.course }))),
  ]);
}

function CarouselNav({ current, onNext, onPrevious, onSelect }) {
  return h("div", { className: "courses-carousel-nav" }, [
    h("button", {
      "aria-label": "Previous courses slide",
      className: "carousel-btn",
      disabled: current === 0,
      id: "coursesPrevBtn",
      key: "previous",
      onClick: onPrevious,
      type: "button",
    }, icon(ChevronLeft, { size: 22 })),
    h(
      "div",
      { className: "carousel-indicators", key: "indicators" },
      COURSE_SLIDES.map((slide, index) =>
        h("button", {
          className: "carousel-indicator" + (index === current ? " active" : ""),
          type: "button",
          "aria-label": `Show ${slide.title}`,
          "aria-current": index === current ? "true" : undefined,
          "data-slide": String(index),
          key: slide.title,
          onClick: () => onSelect(index),
        })),
    ),
    h("button", {
      "aria-label": "Next courses slide",
      className: "carousel-btn",
      disabled: current === COURSE_SLIDES.length - 1,
      id: "coursesNextBtn",
      key: "next",
      onClick: onNext,
      type: "button",
    }, icon(ChevronRight, { size: 22 })),
  ]);
}

export function HomeCoursesApp() {
  const [current, setCurrent] = React.useState(0);
  const [height, setHeight] = React.useState("");
  const slideRefs = React.useRef([]);
  const swipeHandlers = useSwipe((step) => setCurrent((slide) => clampedIndex(slide + step, COURSE_SLIDES.length)));

  const measureHeight = React.useCallback(() => {
    const active = slideRefs.current[current];
    if (active) setHeight(`${active.scrollHeight}px`);
  }, [current]);

  React.useLayoutEffect(() => {
    measureHeight();
  }, [measureHeight]);

  React.useEffect(() => {
    window.addEventListener("resize", measureHeight);
    const timeoutId = window.setTimeout(measureHeight, 250);
    return () => {
      window.removeEventListener("resize", measureHeight);
      window.clearTimeout(timeoutId);
    };
  }, [measureHeight]);

  function go(index) {
    setCurrent(clampedIndex(index, COURSE_SLIDES.length));
  }

  return h("div", { "data-react-home-courses": "ready" }, [
    h("div", {
      className: "courses-carousel-container",
      key: "container",
      style: height ? { height } : undefined,
      ...swipeHandlers,
    },
      h("div", { className: "courses-carousel", style: { transform: `translateX(-${current * 100}%)` } },
        COURSE_SLIDES.map((slide, index) => h(CourseSlide, {
          active: index === current,
          key: slide.title,
          onNext: index < COURSE_SLIDES.length - 1 ? () => go(index + 1) : null,
          onPrevious: index > 0 ? () => go(index - 1) : null,
          onSizeChange: measureHeight,
          slide,
          slideRef: (node) => { slideRefs.current[index] = node; },
        })))),
    h(CarouselNav, {
      current,
      key: "nav",
      onNext: () => go(current + 1),
      onPrevious: () => go(current - 1),
      onSelect: go,
    }),
  ]);
}
