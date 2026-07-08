import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ErrorBoundary from "../ErrorBoundary";

function Bomb(): never {
  throw new Error("boom");
}

describe("ErrorBoundary", () => {
  it("renders children when no error occurs", () => {
    render(<ErrorBoundary><p>fine</p></ErrorBoundary>);
    expect(screen.getByText("fine")).toBeInTheDocument();
  });

  it("renders a fallback with the panel label when a child throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ErrorBoundary label="Sample_CV"><Bomb /></ErrorBoundary>);
    expect(screen.getByText('"Sample_CV" crashed.')).toBeInTheDocument();
    expect(screen.getByText("Reload")).toBeInTheDocument();
    spy.mockRestore();
  });

  it("renders a generic fallback when no label is given", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);
    expect(screen.getByText("Something crashed.")).toBeInTheDocument();
    spy.mockRestore();
  });
});
