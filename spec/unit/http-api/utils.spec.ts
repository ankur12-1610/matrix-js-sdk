/*
Copyright 2022 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { mocked } from "jest-mock";

import {
    anySignal,
    ConnectionError,
    MatrixError,
    parseErrorResponse,
    retryNetworkOperation,
    timeoutSignal,
} from "../../../src";
import { sleep } from "../../../src/utils";

jest.mock("../../../src/utils");

describe("timeoutSignal", () => {
    jest.useFakeTimers();

    it("should fire abort signal after specified timeout", () => {
        const signal = timeoutSignal(3000);
        const onabort = jest.fn();
        signal.onabort = onabort;
        expect(signal.aborted).toBeFalsy();
        expect(onabort).not.toHaveBeenCalled();

        jest.advanceTimersByTime(3000);
        expect(signal.aborted).toBeTruthy();
        expect(onabort).toHaveBeenCalled();
    });
});

describe("anySignal", () => {
    jest.useFakeTimers();

    it("should fire when any signal fires", () => {
        const { signal } = anySignal([
            timeoutSignal(3000),
            timeoutSignal(2000),
        ]);

        const onabort = jest.fn();
        signal.onabort = onabort;
        expect(signal.aborted).toBeFalsy();
        expect(onabort).not.toHaveBeenCalled();

        jest.advanceTimersByTime(2000);
        expect(signal.aborted).toBeTruthy();
        expect(onabort).toHaveBeenCalled();
    });

    it("should cleanup when instructed", () => {
        const { signal, cleanup } = anySignal([
            timeoutSignal(3000),
            timeoutSignal(2000),
        ]);

        const onabort = jest.fn();
        signal.onabort = onabort;
        expect(signal.aborted).toBeFalsy();
        expect(onabort).not.toHaveBeenCalled();

        cleanup();
        jest.advanceTimersByTime(2000);
        expect(signal.aborted).toBeFalsy();
        expect(onabort).not.toHaveBeenCalled();
    });

    it("should abort immediately if passed an aborted signal", () => {
        const controller = new AbortController();
        controller.abort();
        const { signal } = anySignal([controller.signal]);
        expect(signal.aborted).toBeTruthy();
    });
});

describe("parseErrorResponse", () => {
    it("should resolve Matrix Errors from XHR", () => {
        expect(parseErrorResponse({
            getResponseHeader(name: string): string | null {
                return name === "Content-Type" ? "application/json" : null;
            },
            status: 500,
        } as XMLHttpRequest, '{"errcode": "TEST"}')).toStrictEqual(new MatrixError({
            errcode: "TEST",
        }, 500));
    });

    it("should resolve Matrix Errors from fetch", () => {
        expect(parseErrorResponse({
            headers: {
                get(name: string): string | null {
                    return name === "Content-Type" ? "application/json" : null;
                },
            },
            status: 500,
        } as Response, '{"errcode": "TEST"}')).toStrictEqual(new MatrixError({
            errcode: "TEST",
        }, 500));
    });

    it("should handle no type gracefully", () => {
        expect(parseErrorResponse({
            headers: {
                get(name: string): string | null {
                    return null;
                },
            },
            status: 500,
        } as Response, '{"errcode": "TEST"}')).toStrictEqual(new Error("Server returned 500 error"));
    });

    it("should handle invalid type gracefully", () => {
        expect(parseErrorResponse({
            headers: {
                get(name: string): string | null {
                    return name === "Content-Type" ? " " : null;
                },
            },
            status: 500,
        } as Response, '{"errcode": "TEST"}'))
            .toStrictEqual(new Error("Error parsing Content-Type ' ': TypeError: invalid media type"));
    });

    it("should handle plaintext errors", () => {
        expect(parseErrorResponse({
            headers: {
                get(name: string): string | null {
                    return name === "Content-Type" ? "text/plain" : null;
                },
            },
            status: 418,
        } as Response, "I'm a teapot")).toStrictEqual(new Error("Server returned 418 error: I'm a teapot"));
    });
});

describe("retryNetworkOperation", () => {
    it("should retry given number of times with exponential sleeps", async () => {
        const err = new ConnectionError("test");
        const fn = jest.fn().mockRejectedValue(err);
        mocked(sleep).mockResolvedValue(undefined);
        await expect(retryNetworkOperation(4, fn)).rejects.toThrow(err);
        expect(fn).toHaveBeenCalledTimes(4);
        expect(mocked(sleep)).toHaveBeenCalledTimes(3);
        expect(mocked(sleep).mock.calls[0][0]).toBe(2000);
        expect(mocked(sleep).mock.calls[1][0]).toBe(4000);
        expect(mocked(sleep).mock.calls[2][0]).toBe(8000);
    });

    it("should bail out on errors other than ConnectionError", async () => {
        const err = new TypeError("invalid JSON");
        const fn = jest.fn().mockRejectedValue(err);
        mocked(sleep).mockResolvedValue(undefined);
        await expect(retryNetworkOperation(3, fn)).rejects.toThrow(err);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should return newest ConnectionError when giving up", async () => {
        const err1 = new ConnectionError("test1");
        const err2 = new ConnectionError("test2");
        const err3 = new ConnectionError("test3");
        const errors = [err1, err2, err3];
        const fn = jest.fn().mockImplementation(() => {
            throw errors.shift();
        });
        mocked(sleep).mockResolvedValue(undefined);
        await expect(retryNetworkOperation(3, fn)).rejects.toThrow(err3);
    });
});
