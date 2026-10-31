"use client";

import type React from "react";
import dynamic from "next/dynamic";
import type SignatureCanvasType from "react-signature-canvas";

type SignatureCanvasProps = {
  canvasProps?: React.CanvasHTMLAttributes<HTMLCanvasElement>;
  canvasRef?: React.Ref<SignatureCanvasType>;
  penColor?: string;
  throttle?: number;
};

export const SignatureCanvas = dynamic<SignatureCanvasProps>(
  async () => {
    const { default: Canvas } = await import("react-signature-canvas");
    // Next's loadable component owns its ref; pass the pad ref as a regular prop.
    return function SignatureCanvasWithRef({
      canvasRef,
      ...props
    }: SignatureCanvasProps) {
      return <Canvas {...props} ref={canvasRef} />;
    };
  },
  { ssr: false },
);
