-- Guest event registration (members + guests). Adds an optional contact email captured for guest
-- sign-ups (members are already reachable through their account). Guests register under a unique
-- member_id of the form "g_<token>"; the random token is returned to the browser so the guest can
-- manage (withdraw / check in) their own registration. Harmless for existing member rows (email NULL).
ALTER TABLE registrations ADD COLUMN email TEXT;
