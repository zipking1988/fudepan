import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AppointmentClarifiedFacts, AppointmentStepFacts } from "./appointment-facts";

const PAYLOAD = {
  location: "Fake Clinic",
  appointment_time: "2026-12-05T01:00:00Z",
  timezone: "Asia/Tokyo",
  clarified_by: "d1000000-0000-4000-8000-000000000002",
  clarified_by_member_id: "d2000000-0000-4000-8000-000000000002",
  previous: null,
};

describe("appointment details on the step card", () => {
  it("shows the hospital and the time in the zone it was entered in, with the zone named", () => {
    const html = renderToStaticMarkup(
      <dl>
        <AppointmentStepFacts
          location="Fake Clinic"
          appointmentTime="2026-12-05T01:00:00+00:00"
          appointmentTimezone="Asia/Tokyo"
        />
      </dl>,
    );
    expect(html).toContain("<dt>Hospital or clinic</dt>");
    expect(html).toContain("Fake Clinic");
    expect(html).toContain('<time dateTime="2026-12-05T01:00:00+00:00">Sat, December 5, 2026 at 10:00 AM</time>');
    expect(html).toContain("(Asia/Tokyo time)");
  });

  it("renders nothing when no details were saved", () => {
    const html = renderToStaticMarkup(
      <dl>
        <AppointmentStepFacts location={null} appointmentTime={null} appointmentTimezone={null} />
      </dl>,
    );
    expect(html).toBe("<dl></dl>");
  });
});

describe("appointment_clarified in the timeline", () => {
  it("shows the saved details and who supplied them", () => {
    const html = renderToStaticMarkup(
      <dl>
        <AppointmentClarifiedFacts payload={PAYLOAD} actorName="Misa" />
      </dl>,
    );
    expect(html).toContain("<dt>Hospital or clinic</dt><dd>Fake Clinic</dd>");
    expect(html).toContain("Sat, December 5, 2026 at 10:00 AM");
    expect(html).toContain("(Asia/Tokyo time)");
    expect(html).toContain("<dt>Supplied by</dt><dd>Misa</dd>");
    expect(html).not.toContain("Replaced");
  });

  it("shows what a correction replaced", () => {
    const html = renderToStaticMarkup(
      <dl>
        <AppointmentClarifiedFacts
          payload={{
            ...PAYLOAD,
            location: "Fake Clinic East",
            previous: { location: "Fake Clinic", appointment_time: "2026-12-05T01:00:00Z", timezone: "Asia/Tokyo" },
          }}
          actorName="Yui"
        />
      </dl>,
    );
    expect(html).toContain("<dt>Replaced</dt><dd>Fake Clinic, ");
  });

  it("says plainly when the record cannot be read instead of showing a wrong time", () => {
    const html = renderToStaticMarkup(
      <dl>
        <AppointmentClarifiedFacts payload={{ ...PAYLOAD, appointment_time: "2026-12-05T10:00:00" }} actorName="Misa" />
      </dl>,
    );
    expect(html).toContain("could not be shown");
    expect(html).not.toContain("10:00 AM");
  });

  it("falls back to a neutral label when the person is no longer a member", () => {
    const html = renderToStaticMarkup(
      <dl>
        <AppointmentClarifiedFacts payload={PAYLOAD} actorName={null} />
      </dl>,
    );
    expect(html).toContain("<dt>Supplied by</dt><dd>A household member</dd>");
  });
});
