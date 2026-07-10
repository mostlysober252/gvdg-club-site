const stats = {
  pdga: "90000001",
  name: "GVDG QA Dashboard",
  official_rating: 935,
  rating_date: "2026-07-01",
  live_rating: 941,
  peak_rating: 958,
  events_count: 3,
  events: [
    {
      tournament: "Memorial Day Showdown 2026 (CEP Charity - Rated)",
      date: "Jul 4 2026",
      epoch: 1783123200,
      division: "MA2",
      rounds: [
        { rating: 943, score: 54, round: "1" },
        { rating: 951, score: 52, round: "2" },
      ],
    },
    {
      tournament: "Irate Armada Challenge IV (CEP Charity - Rated)",
      date: "Jun 14 2026",
      epoch: 1781481600,
      division: "MA40",
      rounds: [
        { rating: 906, score: 56, round: "1" },
      ],
    },
    {
      tournament: "GVDG Monthly",
      date: "May 31 2026",
      epoch: 1780185600,
      division: "MA2",
      rounds: [
        { rating: 888, score: 59, round: "1" },
        { rating: 836, score: 64, round: "2" },
      ],
    },
  ],
};

const myRatings = {
  competitive: {
    live_rating: 906,
    rated_rounds: 1,
    rounds_count: 1,
    rounds: [
      {
        id: 101,
        label: "GVDG QA Weekly",
        date: "2026-07-04",
        place: 2,
        total: 56,
        to_par: 2,
        rating: 906,
        rating_source: "stored",
        udisc_course_id: "12345678",
        scorecard: JSON.stringify([
          { hole: 1, par: 3, strokes: 3 },
          { hole: 2, par: 3, strokes: 4 },
          { hole: 3, par: 3, strokes: 3 },
        ]),
      },
    ],
  },
  casual: {
    live_rating: 890,
    rated_rounds: 1,
    rounds_count: 1,
    rounds: [
      {
        id: 202,
        label: "ECU North Rec Complex - Pee Dee's Treasure Map",
        date: "2026-07-05T14:00:00Z",
        total: 58,
        to_par: 4,
        rating: 890,
        rating_source: "estimated",
        udisc_course_id: "12345678",
        scorecard: JSON.stringify([
          { hole: 1, par: 3, strokes: 4 },
          { hole: 2, par: 3, strokes: 3 },
          { hole: 3, par: 3, strokes: 4 },
        ]),
      },
    ],
  },
};

const openEvents = [
  {
    id: "event-qa-doubles",
    name: "GVDG QA Doubles",
    date: "2026-07-08",
    status: "scheduled",
    course_name: "ECU North Rec Complex",
    layout_name: "Pee Dee's Treasure Map",
    total_par: 54,
    entry_fee_cents: 500,
    play_format: "doubles",
    divisions: JSON.stringify(["MA2", "FA2"]),
    liveScoringConfig: { groupFormat: "doubles", scoringStyle: "stroke" },
  },
];

const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mP8z8BQDwAFgwJ/lwytjAAAAABJRU5ErkJggg==", "base64");

function json(body, status = 200) {
  return { status, contentType: "application/json", body: JSON.stringify(body) };
}

function png(body, status = 200) {
  return { status, contentType: "image/png", body };
}

function initialBoardPost() {
  return {
    id: 501,
    member_id: "member-2",
    author_name: "QA Cardmate",
    created_at: "Jul 5, 2026",
    body: "**League night** is set for Wednesday.\n\n- Check in by 5:30",
    replies: [
      {
        id: 502,
        parent_id: 501,
        member_id: "member-1",
        author_name: "QA Admin",
        created_at: "Jul 5, 2026",
        body: "I can help with cards.",
      },
    ],
  };
}

function initialCasualRequest() {
  return {
    id: 31,
    course_id: 1,
    layout_id: 11,
    created_by: "other-member",
    created_by_name: "QA Cardmate",
    starts_at: "2026-07-06T22:00:00Z",
    notes: "Warm-up round before league",
    status: "open",
    round_code: null,
    created_at: "2026-07-05T12:00:00Z",
    updated_at: "2026-07-05T12:00:00Z",
    course_name: "ECU North Rec Complex",
    course_location: "Greenville, NC",
    layout_name: "Pee Dee's Treasure Map",
    player_count: 1,
    players: ["QA Cardmate"],
    committed: false,
  };
}

function postedCasualRequest(body) {
  return {
    id: 77,
    course_id: body.course_id,
    layout_id: body.layout_id,
    created_by: "member-1",
    created_by_name: "QA Admin",
    starts_at: body.starts_at,
    notes: body.notes,
    status: "open",
    round_code: null,
    created_at: "2026-07-06T12:00:00Z",
    updated_at: "2026-07-06T12:00:00Z",
    course_name: "ECU North Rec Complex",
    course_location: "Greenville, NC",
    layout_name: "Pee Dee's Treasure Map",
    player_count: 1,
    players: ["QA Admin"],
    committed: true,
  };
}

function initialTeeSign() {
  return {
    id: 701,
    course_id: 1,
    hole_number: 7,
    r2_key: "qa/sign-701.png",
    content_type: "image/png",
    bytes: tinyPng.length,
    uploaded_by: "member-1",
    created_at: "2026-07-05T18:00:00Z",
    status: "candidate",
    extracted_json: JSON.stringify({
      layouts: [
        { label: "Blue", par: 3, distance_ft: 318, color: "blue" },
        { label: "White", par: 3, distance_ft: 276, color: "white" },
      ],
    }),
    extract_source: "qa",
  };
}

export async function installMemberDashboardApiRoutes(page, apiBase) {
  const state = {
    boardPostBody: null,
    boardPosts: [initialBoardPost()],
    casualPostBody: null,
    casualRequests: [initialCasualRequest()],
    nextBoardId: 503,
    nextTeeSignId: 702,
    teeSignPostBody: null,
    teeSigns: [initialTeeSign()],
  };

  await page.route(`${apiBase}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathName = url.pathname;
    const method = request.method();

    if (pathName === "/me") return route.fulfill(json({ sub: "member-1", isAdmin: true, name: "QA Admin", pdgaNo: "90000001" }));
    if (pathName === "/pdga-stats") return route.fulfill(json(stats));
    if (pathName.startsWith("/my-ratings")) return route.fulfill(json(myRatings));
    if (pathName === "/shop/wallet") return route.fulfill(json({
      balance_cents: 1250,
      transactions: [{ id: "tx-1", source: "event_payout", amount_cents: 1250, note: "QA payout", created_at: "2026-07-05T12:00:00Z" }],
    }));
    if (pathName === "/my-live-rounds") return route.fulfill(json({ rounds: [] }));
    if (pathName === "/payments/config") return route.fulfill(json({ enabled: false }));
    if (pathName === "/registration/open") return route.fulfill(json({ events: openEvents }));
    if (pathName === "/my-registrations") return route.fulfill(json({ registrations: [] }));
    if (pathName === "/casual-rounds" && method === "GET") return route.fulfill(json({ requests: state.casualRequests }));
    if (pathName === "/casual-rounds" && method === "POST") {
      state.casualPostBody = JSON.parse(request.postData() || "{}");
      state.casualRequests = [postedCasualRequest(state.casualPostBody), ...state.casualRequests];
      return route.fulfill(json({ id: 77 }, 201));
    }
    if (/^\/casual-rounds\/\d+$/.test(pathName) && method === "DELETE") {
      const id = Number(pathName.split("/").pop());
      state.casualRequests = state.casualRequests.filter((row) => Number(row.id) !== id);
      return route.fulfill(json({ ok: true }));
    }
    if (pathName === "/courses") return route.fulfill(json({ courses: [{ id: 1, name: "ECU North Rec Complex" }] }));
    if (pathName === "/courses/1/layouts") return route.fulfill(json({ layouts: [{ id: 11, name: "Pee Dee's Treasure Map" }] }));
    if (pathName === "/meetings") return route.fulfill(json({ meetings: [] }));
    if (pathName === "/board" && method === "GET") {
      return route.fulfill(json({
        posts: state.boardPosts,
        authors: {},
      }));
    }
    if (pathName === "/board" && method === "POST") {
      state.boardPostBody = JSON.parse(request.postData() || "{}");
      const post = {
        id: state.nextBoardId++,
        parent_id: state.boardPostBody.parent_id || null,
        member_id: "member-1",
        author_name: "QA Admin",
        created_at: "Jul 6, 2026",
        body: state.boardPostBody.body,
        replies: [],
      };
      if (post.parent_id) {
        const parent = state.boardPosts.find((row) => row.id === post.parent_id);
        if (parent) parent.replies = [...(parent.replies || []), post];
      } else {
        state.boardPosts = [post, ...state.boardPosts];
      }
      return route.fulfill(json({ post }, 201));
    }
    if (pathName.startsWith("/board/") && method === "DELETE") {
      const id = Number(pathName.split("/").pop());
      state.boardPosts = state.boardPosts.filter((post) => Number(post.id) !== id)
        .map((post) => ({ ...post, replies: (post.replies || []).filter((reply) => Number(reply.id) !== id) }));
      return route.fulfill(json({ ok: true }));
    }
    if (pathName === "/leagues/active") return route.fulfill(json({ leagues: [], events: [] }));
    if (pathName === "/my-tee-signs") return route.fulfill(json({ teeSigns: state.teeSigns }));
    if (pathName === "/tee-signs" && method === "POST") {
      state.teeSignPostBody = JSON.parse(request.postData() || "{}");
      const row = {
        id: state.nextTeeSignId++,
        course_id: state.teeSignPostBody.courseId,
        hole_number: state.teeSignPostBody.hole,
        r2_key: `qa/sign-${state.nextTeeSignId}.jpg`,
        content_type: "image/jpeg",
        bytes: 512,
        uploaded_by: "member-1",
        created_at: "2026-07-06T12:00:00Z",
        status: "candidate",
        extracted_json: null,
        extract_source: null,
      };
      state.teeSigns = [row, ...state.teeSigns];
      return route.fulfill(json({ teeSign: row }, 201));
    }
    if (/^\/tee-signs\/\d+\/image$/.test(pathName)) return route.fulfill(png(tinyPng));
    if (pathName.startsWith("/shop/")) return route.fulfill(json({ ok: true }));
    return route.fulfill(json({ ok: true }));
  });

  return state;
}
