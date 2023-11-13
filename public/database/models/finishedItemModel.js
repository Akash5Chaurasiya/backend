"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const finishedItem_1 = __importDefault(require("../schemas/finishedItem"));
const FinishedItemModel = mongoose_1.default.model("FinishedItem", finishedItem_1.default);
exports.default = FinishedItemModel;
