import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Select } from "./select";

const options = [
  { value: "password", label: "Password" },
  { value: "key", label: "SSH key" },
  { value: "agent", label: "SSH agent" },
];

describe("Select", () => {
  for (const option of options) {
    it(`renders ${option.value} as selected`, () => {
      const html = renderToStaticMarkup(
        <Select
          value={option.value}
          onValueChange={() => undefined}
          options={options}
        />,
      );

      expect(html).toContain(
        `<option value="${option.value}" selected="">${option.label}</option>`,
      );
    });
  }
});
