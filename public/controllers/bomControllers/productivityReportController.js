"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmployeeReport = exports.SingleEmployeeReport = exports.singleMachineReport = exports.getReportPerMachine = exports.getReportPerEmployee = void 0;
const catchAsyncError_1 = __importDefault(require("../../utils/catchAsyncError"));
const employeeModel_1 = __importDefault(require("../../database/models/employeeModel"));
const v2attendanceModel_1 = __importDefault(require("../../database/models/v2attendanceModel"));
const productionSlipModel_1 = __importDefault(require("../../database/models/productionSlipModel"));
const jobProfileModel_1 = __importDefault(require("../../database/models/jobProfileModel"));
const employeeDocsModel_1 = __importDefault(require("../../database/models/employeeDocsModel"));
const productionSlipController_1 = require("./productionSlipController");
const shopModel_1 = __importDefault(require("../../database/models/shopModel"));
const shopLogModel_1 = __importDefault(require("../../database/models/shopLogModel"));
const groupModel_1 = __importDefault(require("../../database/models/groupModel"));
const machineModel_1 = __importDefault(require("../../database/models/machineModel"));
const globalProcessModel_1 = __importDefault(require("../../database/models/globalProcessModel"));
// getting employee report
exports.getReportPerEmployee = (0, catchAsyncError_1.default)(async (req, resp, next) => {
    const { employeeIds, jobProfileNames, groupNames, shops, date, nextDate, shifts, } = req.body;
    let newDate;
    let newNextDate;
    if (date && nextDate) {
        newDate = new Date(date);
        newNextDate = new Date(nextDate);
        newNextDate.setDate(newNextDate.getDate() + 1);
    }
    else if (date) {
        newDate = new Date(date);
        newNextDate = new Date(newDate);
        newNextDate.setDate(newNextDate.getDate() + 1);
    }
    else {
        newDate = new Date(new Date());
        newNextDate = new Date(newDate);
        newNextDate.setDate(newNextDate.getDate() + 1);
    }
    //  console.log(newDate,newNextDate)
    const EmployeeIds = [];
    //   console.log(employeeIds && employeeIds.length>0 && !shops)
    if (employeeIds && employeeIds.length > 0 && shops && shops.length == 0) {
        employeeIds.forEach((e) => {
            EmployeeIds.push(e);
        });
    }
    else if (shops && shops.length) {
        const selectedShops = await shopModel_1.default.find({
            shopName: { $in: shops },
        }).lean();
        //  console.log(selectedShops);
        const shopIds = selectedShops.map((s) => s._id);
        if (employeeIds && employeeIds.length > 0) {
            const shopLogs = await shopLogModel_1.default.find({
                shopId: shopIds,
                "employees.employeeId": { $in: employeeIds },
                date: {
                    $gte: newDate,
                    $lt: newNextDate,
                },
            });
            for (let s of shopLogs) {
                for (let e of s.employees) {
                    if (employeeIds.includes(e.employeeId + "")) {
                        const id = e.employeeId;
                        EmployeeIds.push(id);
                    }
                }
            }
        }
        else {
            const shopLogs = await shopLogModel_1.default.find({
                shopId: shopIds,
                date: {
                    $gte: newDate,
                    $lt: newNextDate,
                },
            });
            for (let s of shopLogs) {
                for (let e of s.employees) {
                    const id = e.employeeId;
                    EmployeeIds.push(id);
                }
            }
        }
    }
    if (jobProfileNames && jobProfileNames.length > 0) {
        const jobProfileDetails = await jobProfileModel_1.default.find({
            jobProfileName: { $in: jobProfileNames },
        }).lean();
        const jobProfileIds = jobProfileDetails.map((j) => j._id);
        const employees = await employeeModel_1.default.find({
            jobProfileId: { $in: jobProfileIds },
        });
        employees.forEach((e) => {
            EmployeeIds.push(e._id);
        });
    }
    if (groupNames && groupNames.length > 0) {
        const Groups = await groupModel_1.default
            .find({ groupName: { $in: groupNames } })
            .lean();
        const groupIds = Groups.map((g) => g._id);
        const employees = await employeeModel_1.default.find({
            groupId: { $in: groupIds },
        }).lean();
        employees.forEach((e) => {
            const id = e._id;
            EmployeeIds.push(id);
        });
    }
    const allProductionSlips = await productionSlipModel_1.default.find()
        .select({ productionSlipNumber: 1, shop: 1, process: 1 })
        .lean();
    const productionSlipStore = {};
    allProductionSlips.forEach((p) => {
        const productionSlipNumber = p.productionSlipNumber + "";
        productionSlipStore[productionSlipNumber] = {
            ...p,
        };
    });
    const jobProfiles = await jobProfileModel_1.default.find().lean();
    const jobProfileStore = {};
    jobProfiles.forEach((j) => {
        const id = j._id + "";
        jobProfileStore[id] = {
            ...j,
        };
    });
    const employeeDocs = await employeeDocsModel_1.default.find({
        employeeId: { $in: EmployeeIds },
    }).lean();
    const docsStore = {};
    employeeDocs.forEach((e) => {
        const id = e.employeeId + "";
        docsStore[id] = {
            ...e,
        };
    });
    const employees = await employeeModel_1.default.find({
        _id: { $in: EmployeeIds },
    }).lean();
    const employeeStore = {};
    employees.forEach((e) => {
        const id = e._id + "";
        employeeStore[id] = { ...e };
    });
    const allAttendance = await v2attendanceModel_1.default
        .find({
        employeeId: { $in: EmployeeIds },
        date: {
            $gte: newDate,
            $lte: newNextDate,
        },
        shift: { $in: shifts },
    })
        .lean();
    const result = [];
    let shopNewField = 0;
    let shopProductiveHours = 0;
    for (let a of allAttendance) {
        const employeeId = a.employeeId + "";
        const employee = employeeStore[employeeId];
        const punchIn = new Date(a.punches[0].punchIn);
        const shift = a.shift;
        let punchOut;
        let totalhours = 0;
        if (a.punches[a.punches.length - 1].punchOut) {
            punchOut = new Date(a.punches[a.punches.length - 1].punchOut);
            totalhours =
                (punchOut.getTime() - punchIn.getTime()) / (60 * 60 * 1000);
        }
        else {
            const currentTime = new Date();
            currentTime.setTime(currentTime.getTime() + 330 * 60 * 1000);
            totalhours =
                (currentTime.getTime() - punchIn.getTime()) / (60 * 60 * 1000);
        }
        let totalProductiveHours;
        let slipNumbers = [];
        totalProductiveHours = a.productiveHours;
        slipNumbers = a.productionSlipNumbers;
        const productionSlips = [];
        slipNumbers?.forEach((p) => {
            const productionSlip = productionSlipStore[p];
            if (productionSlip) {
                productionSlips.push(productionSlip);
            }
        });
        const data = await (0, exports.SingleEmployeeReport)({ employeeId: employee._id + "", date, shift });
        const newResult = data?.result?.newResult || [];
        let totalNewField = 0;
        if (newResult.length) {
            let index = 0;
            for (let n of newResult) {
                let totalActualTime = 0;
                let totalProduction = 0;
                let actualTime = 0;
                for (let d of n.data) {
                    totalActualTime += d.actualTime || 0;
                    totalProduction += d.actualPartPerHour * d.actualTime || 0;
                }
                ;
                const weightedAverage = totalProduction / totalActualTime;
                n.weightedAverage = weightedAverage;
                let productivityPercentage = 0;
                for (let d of n.data) {
                    const percentage = (((d.actualPartPerHour || 0) - weightedAverage) / weightedAverage) * 100;
                    d.percentage = percentage;
                    if (slipNumbers[index] === d.productionSlipNumber) {
                        productivityPercentage = d.percentage;
                        actualTime = d.actualTime || 0;
                    }
                }
                ;
                index++;
                n.productivityPercentage = productivityPercentage || 0;
                n.newField = productivityPercentage * actualTime;
                totalNewField += n.newField;
            }
        }
        totalNewField = totalNewField / totalProductiveHours;
        const obj = {
            date: a.date,
            shift: a?.shift,
            employeeName: employee.name,
            employeeId: employee._id,
            employeeCode: employee.employeeCode,
            jobProfileName: jobProfileStore[employee.jobProfileId + ""].jobProfileName,
            profilePicture: docsStore[employee._id + ""]?.profilePicture || "",
            productionSlips,
            totalhours,
            totalNewField,
            totalProductiveHours,
            slipNumbers,
            newResult
        };
        shopNewField += totalNewField * totalProductiveHours;
        shopProductiveHours += totalProductiveHours;
        result.push(obj);
    }
    resp.status(200).json({
        success: true,
        message: `Getting report successfully.`,
        shopReport: {
            shopProductiveHours,
            shopNewField
        },
        result,
    });
});
// MACHINE REPORT
exports.getReportPerMachine = (0, catchAsyncError_1.default)(async (req, resp, next) => {
    const { date, shop, machinesArr } = req.body;
    let startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);
    let endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);
    let query = {};
    if (machinesArr && machinesArr.length > 0) {
        query["machineName"] = {
            $in: machinesArr,
        };
    }
    // SHOP FILTER
    if (shop && shop.length > 0) {
        let shopIds = [];
        const shops = await shopModel_1.default.find({ shopName: { $in: shop } });
        shops.forEach((s) => {
            shopIds.push(s._id);
        });
        if (shopIds.length > 0) {
            let processIds = [];
            const processes = await globalProcessModel_1.default.find({
                "shop.shopId": { $in: shopIds },
            });
            processes.forEach((p) => {
                processIds.push(p._id);
            });
            if (processIds.length > 0) {
                query["process"] = {
                    $in: processIds,
                };
            }
        }
    }
    const machines = await machineModel_1.default.find({
        ...query,
    });
    const machineStore = {};
    let machineIds = [];
    machines.forEach((m) => {
        machineStore[m._id] = {
            machineName: m.machineName,
            productiveTimeArr: [],
            productiveHour: 0,
            totalWorkingHours: 0,
            productionSlips: [],
            process: [],
            shop: [],
        };
        machineIds.push(m._id);
    });
    const productionSlips = await productionSlipModel_1.default.find({
        durationFrom: {
            $gte: startDate,
            $lte: endDate,
        },
        status: { $nin: "cancel" },
        "working.machines.machineId": {
            $in: machineIds,
        },
    }).lean();
    productionSlips.forEach((p) => {
        p.working.forEach((w) => {
            w.machines.forEach((m) => {
                const startTime = w.startTime
                    ? new Date(w.startTime).getTime()
                    : new Date().getTime();
                const endTime = w.endTime
                    ? new Date(w.endTime).getTime()
                    : new Date().getTime();
                const workingTime = (endTime - startTime) / (1000 * 60 * 60);
                if (machineStore[m.machineId + ""]) {
                    const obj = {
                        startTime: new Date(startTime),
                        endTime: new Date(endTime),
                    };
                    machineStore[m.machineId + ""] = {
                        ...machineStore[m.machineId + ""],
                        totalWorkingHours: machineStore[m.machineId + ""].totalWorkingHours + workingTime,
                        productionSlips: machineStore[m.machineId + ""].productionSlips.includes(p.productionSlipNumber)
                            ? [...machineStore[m.machineId + ""].productionSlips]
                            : [
                                ...machineStore[m.machineId + ""].productionSlips,
                                p.productionSlipNumber,
                            ],
                        process: machineStore[m.machineId + ""].productionSlips.includes(p.productionSlipNumber)
                            ? [...machineStore[m.machineId + ""].process]
                            : [
                                ...machineStore[m.machineId + ""].process,
                                p.process.processName,
                            ],
                        shop: machineStore[m.machineId + ""].productionSlips.includes(p.productionSlipNumber)
                            ? [...machineStore[m.machineId + ""].shop]
                            : [...machineStore[m.machineId + ""].shop, p.shop.shopName],
                    };
                    machineStore[m.machineId + ""].productiveTimeArr.push(obj);
                    machineStore[m.machineId + ""].productiveHour = (0, productionSlipController_1.gettingHours)(machineStore[m.machineId + ""].productiveTimeArr);
                }
                ;
            });
        });
    });
    const result = [];
    for (let m in machineStore) {
        result.push({
            machineName: machineStore[m].machineName,
            productiveHour: machineStore[m].productiveHour,
            totalWorkingHours: machineStore[m].totalWorkingHours,
            productionSlips: machineStore[m].productionSlips,
            process: machineStore[m].process,
            shop: machineStore[m].shop,
        });
    }
    ;
    resp.status(200).json({
        success: true,
        message: "Getting Machine Report Successfully",
        result,
    });
});
// single machine Report 
const singleMachineReport = async (req, resp, next) => {
    const { machineId } = req.body;
    const productionSlips = await productionSlipModel_1.default.find({ "working.machines.machineId": machineId }).lean();
    for (let p of productionSlips) {
        const startTime = new Date(p.durationFrom);
        startTime.setHours(0, 0, 0, 0);
        const endTime = new Date(startTime);
        endTime.setDate(endTime.getDate() + 1);
        const dailyProductionSlip = await productionSlipModel_1.default.find({ "working.machines.machineId": machineId, durationFrom: { $gte: startTime, $lt: endTime } }).lean();
        const timeArray = [];
        const productionSlipNumberTime = [];
        for (let d of dailyProductionSlip) {
            const productionSlipNumber = d.productionSlipNumber + "";
            for (let t of d.working) {
                if (t.startTime && t.endTime) {
                    for (let m of t.machines) {
                        if (m.machineId + "" === machineId + "") {
                            const startTime = new Date(t.startTime);
                            const endTime = new Date(t.endTime);
                            const obj = {
                                startTime,
                                endTime
                            };
                            timeArray.push(obj);
                            productionSlipNumberTime.push({
                                startTime,
                                endTime,
                                productionSlipNumber,
                                ratio: 0
                            });
                        }
                        ;
                    }
                    ;
                }
                ;
            }
            ;
        }
        ;
        const actualWorkingHours = (0, productionSlipController_1.gettingHours)(timeArray) || 0;
        let totalHours = 0;
        productionSlipNumberTime.forEach((p) => {
            const total = (new Date(p.endTime).getTime() - new Date(p.startTime).getTime()) / (60 * 1000);
        });
    }
};
exports.singleMachineReport = singleMachineReport;
// single employee report
const SingleEmployeeReport = async (data) => {
    try {
        const { employeeId, date, shift } = data;
        let newDate;
        let newNextDate;
        newDate = new Date(date);
        newNextDate = new Date(newDate);
        newNextDate.setDate(newNextDate.getDate() + 1);
        const employeeDocs = await employeeDocsModel_1.default.find({
            employeeId: { $in: employeeId },
        }).lean();
        const docsStore = {};
        employeeDocs.forEach((e) => {
            const id = e.employeeId + "";
            docsStore[id] = {
                ...e,
            };
        });
        const allProductionSlips = await productionSlipModel_1.default.find({ status: { $in: ["completed", "cnc"] } }).lean();
        const productionSlipStore = {};
        const partSlipStore = {};
        allProductionSlips.forEach((p) => {
            const id = p.part._id + "";
            const productionSlipNumber = p.productionSlipNumber + "";
            if (!partSlipStore[id]) {
                partSlipStore[id] = { slips: [] };
            }
            partSlipStore[id].slips.push({ ...p });
            productionSlipStore[productionSlipNumber] = { ...p };
        });
        const employee = await employeeModel_1.default.findOne({
            _id: { $in: employeeId },
        }).lean();
        if (!employee) {
            return {
                success: false,
                message: `Employee with id ${employeeId} not found.`,
            };
        }
        const allAttendance = await v2attendanceModel_1.default
            .find({
            employeeId: employee?._id,
            date: {
                $gte: newDate,
                $lte: newNextDate,
            },
            shift: { $in: shift },
        })
            .lean();
        let result = {};
        for (let a of allAttendance) {
            const punchIn = new Date(a.punches[0].punchIn);
            let punchOut;
            let totalhours = 0;
            if (a.punches[a.punches.length - 1].punchOut) {
                punchOut = new Date(a.punches[a.punches.length - 1].punchOut);
                totalhours =
                    (punchOut.getTime() - punchIn.getTime()) / (60 * 60 * 1000);
            }
            else {
                const currentTime = new Date();
                currentTime.setTime(currentTime.getTime() + 330 * 60 * 1000);
                totalhours =
                    (currentTime.getTime() - punchIn.getTime()) / (60 * 60 * 1000);
            }
            let totalProductiveHours;
            let slipNumbers = [];
            totalProductiveHours = a.productiveHours;
            slipNumbers = a.productionSlipNumbers;
            const productionSlips = [];
            if (slipNumbers) {
                for (let p of slipNumbers) {
                    const productionSlip = productionSlipStore[p];
                    if (productionSlip) {
                        productionSlips.push(productionSlip);
                    }
                }
            }
            const newResult = [];
            for (let p of productionSlips) {
                const partId = p.part._id + "";
                const partSlips = partSlipStore[partId];
                const data = await childPartReport(partSlips, productionSlipStore);
                const obj = { data, partName: p.part.partName, partId };
                newResult.push(obj);
            }
            const obj = {
                date: a.date,
                shift: a?.shift,
                employeeName: employee.name,
                employeeId: employee._id,
                employeeCode: employee.employeeCode,
                profilePicture: docsStore[employee._id + ""]?.profilePicture || "",
                productionSlips,
                newResult,
                totalhours,
                totalProductiveHours,
                slipNumbers,
            };
            result = obj;
        }
        return {
            success: true,
            message: "Getting Per employee report successfully.",
            result,
        };
    }
    catch (error) {
        console.log(error);
    }
};
exports.SingleEmployeeReport = SingleEmployeeReport;
const childPartReport = async (partSlips, productionSlipStore) => {
    const productionSlips = partSlips.slips;
    const result = [];
    for (let p of productionSlips) {
        const partId = p.part._id + "";
        for (let w of p.working) {
            let startTime;
            let endTime;
            if (w.startTime) {
                startTime = new Date(w.startTime);
                startTime.setHours(0, 0, 0, 0);
            }
            else {
                return;
            }
            for (let e of w.employees) {
                const employeeId = e.employeeId + "";
                const data = await employeeReportPerPart(employeeId, partId, startTime, productionSlipStore);
                result.push({ ...data, employeeName: e.employeeName, employeeId });
            }
        }
    }
    return result;
};
const employeeReportPerPart = async (employeeId, partId, startTime, productionSlipStore) => {
    const attendance = await v2attendanceModel_1.default.findOne({
        employeeId,
        date: {
            $gte: new Date(startTime),
        },
    });
    if (!attendance) {
        return;
    }
    const productionSlipNumbers = attendance.productionSlipNumbers;
    const totalProductiveTime = attendance.productiveHours || 0;
    let totalTime = 0;
    let childPartTime = 0;
    let totalProductionPerChildPart = 0;
    let totalNumberOfEmployee = 0;
    let productionSlipNumber = "";
    for (let p of productionSlipNumbers) {
        const productionSlip = productionSlipStore[p];
        if (!productionSlip) {
            return;
        }
        if (productionSlip.part._id + "" === partId + "") {
            productionSlipNumber = productionSlip.productionSlipNumber;
            for (let w of productionSlip.working) {
                totalNumberOfEmployee = w.employees.length;
                if (w.startTime && w.endTime) {
                    for (let e of w.employees) {
                        if (employeeId + "" === e.employeeId + "") {
                            totalProductionPerChildPart +=
                                w.itemProduced / totalNumberOfEmployee;
                            childPartTime = (new Date(w.endTime).getTime() - new Date(w.startTime).getTime()) / (60 * 60 * 1000);
                        }
                        ;
                    }
                    ;
                }
                ;
            }
            ;
        }
        ;
        for (let w of productionSlip.working) {
            if (w.startTime && w.endTime) {
                for (let e of w.employees) {
                    if (employeeId + "" === e.employeeId + "") {
                        totalTime += (new Date(w.endTime).getTime() - new Date(w.startTime).getTime()) / (60 * 60 * 1000);
                    }
                    ;
                }
                ;
            }
            ;
        }
        ;
    }
    ;
    const ratio = childPartTime / totalTime || 0;
    const actualTime = ratio * totalProductiveTime || 0;
    const actualPartPerHour = totalProductionPerChildPart / actualTime || 0;
    return {
        actualTime,
        actualPartPerHour,
        ratio,
        productionSlipNumber,
        date: attendance.date,
        totalProductiveTime,
    };
};
// employee report for APP
exports.EmployeeReport = (0, catchAsyncError_1.default)(async (req, resp, next) => {
    const { employeeIds, newDate } = req.body;
    const employeeDetails = await employeeModel_1.default.find({
        _id: { $in: employeeIds },
    }).lean();
    const employeeStore = {};
    const ids = [];
    employeeDetails.forEach((e) => {
        const id = e._id + "";
        ids.push(id);
        employeeStore[id] = {
            ...e,
        };
    });
    let date;
    let nextDate;
    if (newDate) {
        date = new Date(newDate);
        date.setHours(0, 0, 0, 0);
        nextDate = new Date(date);
        nextDate.setDate(nextDate.getDate() + 1);
        nextDate.setHours(0, 0, 0, 0);
    }
    else {
        date = new Date();
        date.setHours(0, 0, 0, 0);
        nextDate = new Date(date);
        nextDate.setDate(nextDate.getDate() + 1);
        nextDate.setHours(0, 0, 0, 0);
    }
    const attendanceDetails = await v2attendanceModel_1.default
        .find({
        employeeId: { $in: ids },
        date: {
            $gte: date,
            $lt: nextDate,
        },
    })
        .lean();
    const result = {};
    for (let a of attendanceDetails) {
        const employeeId = a.employeeId + "";
        const firstPunchIn = new Date(a.punches[0].punchIn);
        firstPunchIn.setTime(firstPunchIn.getTime() - 330 * 60 * 1000);
        const date = new Date();
        date.setTime(date.getTime() + 330 * 60 * 1000);
        const lastPunchOut = a.punches[a.punches.length - 1]?.punchOut
            ? a.punches[a.punches.length - 1]?.punchOut
            : date;
        const newLastPunch = new Date(lastPunchOut);
        newLastPunch.setTime(newLastPunch.getTime() - 330 * 60 * 1000);
        const totalHours = (newLastPunch.getTime() - firstPunchIn.getTime()) / (60 * 60 * 1000);
        const data = await (0, productionSlipController_1.getProductivityPerEmployee)(employeeId, firstPunchIn, newLastPunch);
        const obj = {
            productivity: data?.productiveHours || 0,
            totalHours,
            employeeId,
        };
        result[employeeId] = obj;
    }
    resp.status(200).json({
        success: true,
        message: "Getting productivity per employee.",
        result,
    });
});
