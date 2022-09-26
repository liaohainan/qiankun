/**
 * @author Kuitos
 * @since 2020-04-13
 */

import { isBoundedFunction, isCallable, isConstructable } from '../utils';

type AppInstance = { name: string; window: WindowProxy };
let currentRunningApp: AppInstance | null = null;

/**
 * get the app that running tasks at current tick
 */
export function getCurrentRunningApp() {
  return currentRunningApp;
}

export function setCurrentRunningApp(appInstance: { name: string; window: WindowProxy } | null) {
  // set currentRunningApp and it's proxySandbox to global window, as its only use case is for document.createElement from now on, which hijacked by a global way
  currentRunningApp = appInstance;
}

const functionBoundedValueMap = new WeakMap<CallableFunction, CallableFunction>();

export function getTargetValue(target: any, value: any): any {
  /*
    仅绑定 isCallable && !isBoundedFunction && !isConstructable 的函数对象，如 window.console、window.atob 这类，不然微应用中调用时会抛出 Illegal invocation 异常
    目前没有完美的检测方式，这里通过 prototype 中是否还有可枚举的拓展方法的方式来判断
    @warning 这里不要随意替换成别的判断方式，因为可能触发一些 edge case（比如在 lodash.isFunction 在 iframe 上下文中可能由于调用了 top window 对象触发的安全异常）
    @warning 对于configurable及writable都为false的readonly属性，proxy必须返回原值
   */
  if (isCallable(value) && !isBoundedFunction(value) && !isConstructable(value)) {
    const cachedBoundFunction = functionBoundedValueMap.get(value);
    if (cachedBoundFunction) {
      return cachedBoundFunction;
    }

    const boundValue = Function.prototype.bind.call(value, target);

    // some callable function has custom fields, we need to copy the enumerable props to boundValue. such as moment function.
    // use for..in rather than Object.keys.forEach for performance reason
    // eslint-disable-next-line guard-for-in,no-restricted-syntax
    for (const key in value) {
      boundValue[key] = value[key];
    }

    // copy prototype if bound function not have but target one have
    // as prototype is non-enumerable mostly, we need to copy it from target function manually
    if (value.hasOwnProperty('prototype') && !boundValue.hasOwnProperty('prototype')) {
      // we should not use assignment operator to set boundValue prototype like `boundValue.prototype = value.prototype`
      // as the assignment will also look up prototype chain while it hasn't own prototype property,
      // when the lookup succeed, the assignment will throw an TypeError like `Cannot assign to read only property 'prototype' of function` if its descriptor configured with writable false or just have a getter accessor
      // see https://github.com/umijs/qiankun/issues/1121
      Object.defineProperty(boundValue, 'prototype', { value: value.prototype, enumerable: false, writable: true });
    }

    // Some util, like `function isNative() {  return typeof Ctor === 'function' && /native code/.test(Ctor.toString()) }` relies on the original `toString()` result
    // but bound functions will always return "function() {[native code]}" for `toString`, which is misleading
    if (typeof value.toString === 'function') {
      const valueHasInstanceToString = value.hasOwnProperty('toString') && !boundValue.hasOwnProperty('toString');
      const boundValueHasPrototypeToString = boundValue.toString === Function.prototype.toString;

      if (valueHasInstanceToString || boundValueHasPrototypeToString) {
        const originToStringDescriptor = Object.getOwnPropertyDescriptor(
          valueHasInstanceToString ? value : Function.prototype,
          'toString',
        );

        Object.defineProperty(boundValue, 'toString', {
          ...originToStringDescriptor,
          ...(originToStringDescriptor?.get ? null : { value: () => value.toString() }),
        });
      }
    }

    functionBoundedValueMap.set(value, boundValue);
    return boundValue;
  }

  return value;
}

export const unscopedGlobals = [
  'undefined',
  'Array',
  'Object',
  'String',
  'Boolean',
  'Math',
  'Number',
  'Symbol',
  'parseFloat',
  'Float32Array',
  'isNaN',
  'Infinity',
  'Reflect',
  'Float64Array',
  'Function',
  'Map',
  'NaN',
  'Promise',
  'Proxy',
  'Set',
  'parseInt',
  'requestAnimationFrame',
];

export const lexicalGlobals = [...unscopedGlobals, 'globalThis', 'window', 'self'];
