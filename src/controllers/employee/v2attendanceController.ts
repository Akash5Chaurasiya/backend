import { NextFunction, Request, Response } from "express";
import catchErrorAsync from "../../utils/catchAsyncError";
import { EmployeeDocument } from "../../database/entities/employeeDocument";
import JobProfileModel from "../../database/models/jobProfileModel";
import EmployeeModel from "../../database/models/employeeModel";
import ErrorHandler from "../../middleware/errorHandler";
import { AttendanceDocs } from "../../database/entities/attendanceDocs";
import { getIndianTime } from "../../middleware/dateTimeConverter";
import v2AttendanceModel from "../../database/models/v2attendanceModel";
import { Attendance } from "../../database/schemas/v2AttendanceSchema";
import * as QRCode from "qrcode";
// image
import aws, { S3, TemporaryCredentials } from "aws-sdk";
import { config } from "dotenv";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { extname } from "path";
import departmentModel from "../../database/models/department";
import groupModel from "../../database/models/groupModel";
import EmployeeDocsModel from "../../database/models/employeeDocsModel";
import { JobProfileDocument } from "../../database/entities/jobProfileDocument";
import ShopModel from "../../database/models/shopModel";
import ShopLogModel from "../../database/models/shopLogModel";
import app from "../../app";
import { getProductivityPerEmployee } from "../bomControllers/productionSlipController";
import AdminModel from "../../database/models/adminModel";
config({ path: path.join(__dirname, "../../../", "public/.env") });
aws.config.update({
  secretAccessKey: process.env.ACCESS_SECRET,
  accessKeyId: process.env.ACCESS_KEY,
  region: process.env.REGION,
});
const BUCKET = process.env.BUCKET;
if (!BUCKET) {
  console.error("No bucket specified in the environment configuration.");
  process.exit(1);
}
const s3 = new aws.S3();

interface CustomRequest<T> extends Request {
  admin?: T;
  employee?: T;
  attendanceManager?: T;
  dbManager?: T;
  supervisor?: T;
}

export const addAttendanceWithEmployeeId = catchErrorAsync(
  async (
    req: CustomRequest<EmployeeDocument>,
    resp: Response,
    next: NextFunction
  ) => {
    let jobProfile;
    // checking the jobProfile Name
    if (req.employee) {
      jobProfile = await JobProfileModel.findById(req.employee.jobProfileId);
    }
    let lastPunchOut;
    let lastPunchIn;

    const { id } = req.body;
    let date = new Date();
    let nextDay;
    date = new Date(date);
    date.setHours(0, 0, 0, 0);
    date.setHours(date.getHours() - 11.5);
    // date.setHours(date.getHours() - 6);

    nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 3);
    nextDay.setHours(0, 0, 0, 0);
    nextDay.setHours(nextDay.getHours() - 11.5);
    // nextDay.setHours(nextDay.getHours() - 6);

    date = getIndianTime(date);
    nextDay = getIndianTime(nextDay);
    let message = ``;
    if (
      req.admin ||
      jobProfile?.jobProfileName.toLowerCase() === "hr" ||
      jobProfile?.jobProfileName.toLowerCase() === "security head" ||
      jobProfile?.jobProfileName.toLowerCase() === "security"
    ) {
      let employee = await EmployeeModel.findOne({ _id: id })
        .populate("jobProfileId")
        .populate("groupId")
        .exec();

      if (!employee) {
        return next(new ErrorHandler("Employee not found.", 404));
      }

      let currentDate = new Date();
      currentDate = getIndianTime(currentDate);

      let attendanceRecord: AttendanceDocs | null =
        await v2AttendanceModel.findOne({
          employeeId: employee?._id,
          date: {
            $gte: date,
            $lt: nextDay,
          },
        });

      if (!attendanceRecord) {
        attendanceRecord = new v2AttendanceModel({
          employeeId: employee?._id,
          date: currentDate,
          punches: [
            {
              employeeId: employee?._id,
              punchIn: getIndianTime(new Date()),
              punchInBy: req.employee?._id || req.admin?._id,
            },
          ],
          isPresent: true,
        });
        message = `Attendance punch In successfully.`;
      } else {
        let attDate = new Date(attendanceRecord.date);

        // condition added for night shift

        if (
          currentDate.getDate() !== attDate.getDate() &&
          currentDate.getHours() > 18
        ) {
          attendanceRecord = new v2AttendanceModel({
            employeeId: employee?._id,
            date: currentDate,
            punches: [
              {
                employeeId: employee?._id,
                punchIn: getIndianTime(new Date()),
                punchInBy: req.employee?._id || req.admin?._id,
                status: "pending",
              },
            ],
            isPresent: true,
          });
          message = `Attendance punch In successfully.`;

          return resp.status(200).json({
            success: true,
            message,
            attendance: attendanceRecord,
            employee,
          });
        }

        const todayAttendance = attendanceRecord.punches;
        if (!todayAttendance) {
          attendanceRecord.punches.push({
            punchIn: getIndianTime(new Date()),
            punchInBy: req.employee?._id || req.admin?._id,
          });
          message = `Attendance punch In successfully.`;
        } else {
          const lastPunch = todayAttendance[todayAttendance.length - 1];
          if (lastPunch && lastPunch.punchOut) {
            const newPunch = {
              employeeId: employee?._id,
              punchIn: getIndianTime(new Date()),
              punchInBy: req.employee?._id || req.admin?._id,
            };

            attendanceRecord.punches.push(newPunch);
            message = `Attendance punch In successfully.1`;
          } else {
            const FirstPunchIn = new Date(attendanceRecord.punches[0].punchIn);
            FirstPunchIn.setHours(FirstPunchIn.getHours() - 330 * 60 * 1000);

            const lastPunchout = new Date();
            const data = await getProductivityPerEmployee(
              employee._id,
              FirstPunchIn,
              lastPunchout
            );
            console.log("data for productionSlip", data);
            if (data) {
              attendanceRecord.productiveHours = data.productiveHours;
              attendanceRecord.productionSlipNumbers =
                data.productionSlipNumbers;
            }
            lastPunch.punchOut = getIndianTime(new Date());
            lastPunch.punchOutBy = req.employee?._id || req.admin?._id;
            message = `Attendance punch Out successfully.`;
          }
        }
      }
      await attendanceRecord.save();
      resp.status(200).json({
        success: true,
        message,
        attendance: attendanceRecord,
        // employee,
      });
    } else {
      resp.status(200).json({
        success: false,
        message: "Login first as Security or admin or hr.",
      });
    }
  }
);

export const updateAttendance = catchErrorAsync(
  async (
    req: CustomRequest<EmployeeDocument>,
    resp: Response,
    next: NextFunction
  ) => {
    if (req.employee || req.admin) {
      let employee: EmployeeDocument | null = null;
      let approverId;
      let shopOfLoggedIn: any = null;
      if (req.employee) {
        employee = await EmployeeModel.findById(req.employee._id)
          .populate("jobProfileId")
          .exec();
        const loggedInJobProfile: any = employee?.jobProfileId;
        if (loggedInJobProfile.isSupervisor) {
          approverId = employee?._id;
          shopOfLoggedIn = await ShopModel.findOne({
            "jobProfile.jobProfileId": loggedInJobProfile._id,
          });
          if (!shopOfLoggedIn) {
            resp.status(404).json({
              success: false,
              message: "LoggedIn user is not in  any shop",
            });
          }
        } else if (loggedInJobProfile.isSupervisor == false) {
          resp.status(404).json({
            success: false,
            message: "you are not supervisor",
          });
        }
        if (!employee) {
          resp.status(404).json({
            success: false,
            message: "Employee not found",
          });
        }
      } else {
        approverId = req.admin?._id;
      }
      let { employeeId, status, punchInTime, date, shift } = req.body;
      let nextDay;

      if (date) {
        date = new Date(date);
        date.setHours(0, 0, 0, 0);
        date.setHours(date.getHours() - (6 + 5.5));

        nextDay = new Date(date);
        nextDay.setDate(nextDay.getDate() + 3);
        nextDay.setHours(0, 0, 0, 0);
        nextDay.setHours(nextDay.getHours() - (6 + 5.5));
        date = getIndianTime(date);
        nextDay = getIndianTime(nextDay);
      }
      const employee1 = await EmployeeModel.findById(employeeId);
      if (!employee1) {
        return next(new ErrorHandler("Employee not found.", 404));
      }
      const punchIn = new Date(punchInTime);

      const atten = await v2AttendanceModel.find({
        employeeId,
        date: { $gte: date, $lt: nextDay },
        shift,
      });
      const attendanceId = atten[atten.length - 1]?._id;

      let attendanceRecord = await v2AttendanceModel.findById(attendanceId);

      if (!attendanceRecord) {
        return next(new ErrorHandler("Attendance record not found.", 404));
      }
      let previousArray = false;
      const approvedImage = attendanceRecord.approvedImage;
      if (attendanceRecord.status == "approved") {
        return resp.status(400).json({
          success: false,
          message: "Attendance already approved",
        });
      }
      if (
        status == "approved" ||
        status == "Approved" ||
        status == "APPROVED"
      ) {
        if (approvedImage) {
          attendanceRecord.approvedBy = approverId;
          attendanceRecord.approvedTime = getIndianTime(new Date());
          attendanceRecord.status = status;
          const obj: any = {
            employeeId: employeeId,
            employeeName: employee1.name,
          };
          const shopLogData: any = await ShopLogModel.findOne({
            date: { $gte: date, $lt: nextDay },
            shopId: shopOfLoggedIn._id,
          });
          if (!shopLogData) {
            const Arr: any = [];
            Arr.push(obj);
            await ShopLogModel.create({
              shopId: shopOfLoggedIn._id,
              date: getIndianTime(new Date()),
              employees: Arr,
            });
          } else {
            shopLogData.employees.push(obj);
            await shopLogData.save();
          }
        } else {
          resp.status(400).json({
            success: false,
            message: "Image should be uploaded.",
          });
        }
      }
      if (
        status == "rejected" ||
        status == "Rejected" ||
        status == "REJECTED"
      ) {
        attendanceRecord.approvedBy = approverId;
        attendanceRecord.status = status;
      }
      await attendanceRecord.save();
      resp.status(200).json({
        success: true,
        message: "Attendance approved successfully.",
        attendance: attendanceRecord,
      });
    } else {
      return next(new ErrorHandler("Login first", 404));
    }
  }
);

export const attendanceApproveImage = catchErrorAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const file = req.file;
    // finding employee by group
    const allowedExtensions = [".jpg", ".jpeg", ".png"];
    let { employeeId, date } = req.body;
    const employee1 = await EmployeeModel.findById(employeeId);
    if (!employee1) {
      return next(new ErrorHandler("Employee not found.", 404));
    }
    let nextDay: any;

    if (date) {
      date = new Date(date);
      date.setHours(0, 0, 0, 0);
      date.setHours(date.getHours() - (6 + 5));
      // date.setHours(date.getHours() - 6);

      nextDay = new Date(date);
      nextDay.setDate(nextDay.getDate() + 3);
      nextDay.setHours(0, 0, 0, 0);
      nextDay.setHours(nextDay.getHours() - (6 + 5));
      // nextDay.setHours(nextDay.getHours() - 6);
    }

    date = getIndianTime(date);
    nextDay = getIndianTime(nextDay);

    const atten = await v2AttendanceModel.find({
      employeeId,
      date: {
        $gte: date,
        $lt: nextDay,
      },
    });
    const id = atten[atten.length - 1]._id;
    const attendanceRecord = await v2AttendanceModel.findById(id);
    if (!attendanceRecord) {
      return next(new ErrorHandler("Attendance record not found.", 404));
    }
    let fileUrl;
    if (!file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded.",
      });
    }
    const fileExt = extname(file.originalname).toLowerCase();
    if (!allowedExtensions.includes(fileExt)) {
      return res.status(400).json({
        success: false,
        message: "Invalid file type. Only JPG, JPEG, PNG images are allowed.",
      });
    }
    const fileKey = `uploads/${uuidv4()}-${file.originalname}`;
    const uploadParams: S3.PutObjectRequest = {
      Bucket: BUCKET,
      Key: fileKey,
      Body: file.buffer,
      ACL: "public-read",
    };
    // documentJpg.docs
    await s3.putObject(uploadParams).promise();
    fileUrl = `https://${BUCKET}.s3.amazonaws.com/${fileKey}`;

    attendanceRecord.approvedImage = fileUrl;
    await attendanceRecord.save();

    res.status(200).json({
      success: true,
      message: "Approved image added successfully.",
      attendanceRecord,
    });
  }
);

export const absentAndPresentEmployee = catchErrorAsync(
  async (
    req: CustomRequest<EmployeeDocument>,
    resp: Response,
    next: NextFunction
  ) => {
    let employee: EmployeeDocument | null = null;
    let jobProfile: JobProfileDocument | null = null;

    let {
      date,
      nextDate,
      groupName,
      departmentName,
      jobProfileName,
      name,
      limit = 20,
      page = 1,
    } = req.body;

    limit = +limit;
    page = +page;
    const skip = (page - 1) * limit;

    let filterDate;
    let nextDay;
    if (typeof date === "string") {
      filterDate = new Date(date);
      filterDate.setHours(0, 0, 0, 0);
      // filterDate.setHours(filterDate.getHours() - 6);
    } else {
      filterDate = new Date();
      filterDate.setHours(0, 0, 0, 0);
      // filterDate.setHours(filterDate.getHours() - 6);
    }
    if (typeof nextDate === "string") {
      nextDay = new Date(nextDate);
      nextDay.setHours(0, 0, 0, 0);
      nextDay.setDate(nextDay.getDate() + 1);
      // nextDay.setHours(nextDay.getHours() - 6);
    } else {
      nextDay = new Date(filterDate);
      nextDay.setDate(filterDate.getDate() + 1);
      nextDay.setHours(0, 0, 0, 0);
      // nextDay.setHours(nextDay.getHours() - 6);
    }

    // const isHR = jobProfile?.jobProfileName.toLowerCase() === "hr";
    // const isAdmin = req.admin;
    const filter: any = {};
    const filter1: any = {};
    let jobProfileIds: any = [];
    if (
      groupName &&
      Array.isArray(groupName) &&
      groupName.some((name) => name.trim() !== "")
    ) {
      const nonEmptyGroupNames = groupName.filter((name) => name.trim() !== "");
      const groups = await groupModel
        .find({ groupName: { $in: nonEmptyGroupNames } })
        .exec();
      const groupIds: any = groups.map((group) => group._id);
      filter.groupId = { $in: groupIds };
    }

    // Add departmentName filter if provided and non-empty
    if (
      departmentName &&
      Array.isArray(departmentName) &&
      departmentName.some((name) => name.trim() !== "")
    ) {
      const nonEmptyDepartmentNames = departmentName.filter(
        (name) => name.trim() !== ""
      );
      const departments = await departmentModel
        .find({ departmentName: { $in: nonEmptyDepartmentNames } })
        .exec();
      const departmentIds: any = departments.map(
        (department) => department._id
      );
      const jobProfiles = await JobProfileModel.find({
        department: { $in: departmentIds },
      }).exec();
      const jobProfileIds: any = jobProfiles.map(
        (jobProfile) => jobProfile._id
      );
      filter.jobProfileId = { $in: jobProfileIds };
    }

    // Add jobProfileName filter if provided and non-empty
    if (
      jobProfileName &&
      Array.isArray(jobProfileName) &&
      jobProfileName.some((name) => name.trim() !== "")
    ) {
      const nonEmptyJobProfileNames = jobProfileName.filter(
        (name) => name.trim() !== ""
      );
      const jobProfiles = await JobProfileModel.find({
        jobProfileName: { $in: nonEmptyJobProfileNames },
      }).exec();
      const ids: any = jobProfiles.map((jobProfile) => jobProfile._id);
      jobProfileIds = [...jobProfileIds, ...ids];
      filter.jobProfileId = { $in: jobProfileIds };
    }

    if (name) {
      filter.$or = [{ name: name }, { employeeCode: name }];
      filter1.$or = [{ name: name }, { employeeCode: name }];
    }
    const employeeDocsStore: any = {};
    const employeeDocs = await EmployeeDocsModel.find({}).lean();

    employeeDocs.forEach((e) => {
      const id = e.employeeId + "";
      employeeDocsStore[id] = {
        profilePicture: e.profilePicture,
      };
    });
    const allShops = await ShopModel.find({}).lean();
    const shopStore: any = {};

    allShops.forEach((a) => {
      const id = a.jobProfile.jobProfileId + "";
      shopStore[id] = {
        shopId: a._id,
        shop: a.shopName,
        shopCode: a.shopCode,
      };
    });

    const allAdmin = await AdminModel.find({}).lean();
    const adminStore: any = {};
    allAdmin.forEach((a) => {
      const id = a._id + "";
      adminStore[id] = {
        id: a._id,
        name: a.name,
      };
    });
    const allEmp = await EmployeeModel.find({}).lean();
    const empStore: any = {};
    allEmp.forEach((a) => {
      const id = a._id + "";
      empStore[id] = {
        id: a._id,
        name: a.name,
      };
    });

    // admin condition
    const employeeIds = await EmployeeModel.find(filter)
      .skip(skip)
      .limit(limit)
      .exec();

    const employeeid = await EmployeeModel.find(filter).exec();
    const empids = employeeid.map((employee) => employee._id);

    const ids = employeeIds.map((employee) => employee._id);
    const documnetLength = await v2AttendanceModel.countDocuments({
      employeeId: { $in: empids },
      date: {
        $gte: filterDate,
        $lt: nextDay,
      },
    });
    const attendanceRecords: any = await v2AttendanceModel
      .find({
        employeeId: { $in: ids },
        date: {
          $gte: filterDate,
          $lt: nextDay,
        },
      })
      .populate({
        path: "approvedBy",
        select: "name",
        populate: {
          path: "jobProfileId",
          select: "jobProfileName",
        },
      })
      .populate({
        path: "employeeId",
        select: { name: 1, employeeCode: 1, jobProfileId: 1, groupId: 1 },
        populate: {
          path: "jobProfileId",
          select: {
            jobProfileName: 1,
            jobDescription: 1,
            isSupervisor: 1,
          },
        },
      })
      .populate({
        path: "employeeId",
        select: { name: 1, employeeCode: 1, jobProfileId: 1, groupId: 1 },
        populate: {
          path: "groupId",
          select: { groupName: 1 },
        },
      })
      .select("-createdAt -updatedAt")
      .exec();
    attendanceRecords.sort((a: any, b: any) =>
      a.employeeId.name.localeCompare(b.employeeId.name)
    );

    let newRecords: any = [];
    for (let rec of attendanceRecords) {
      const id = rec.employeeId._id + "";
      const docs = employeeDocsStore[id];
      if (docs) {
        const doc = {
          ...rec.toObject(),
          profilePicture: docs.profilePicture,
        };
        if (rec.approvedBy) {
          const id = rec.approvedBy.jobProfileId?._id + "";

          const shop = shopStore[id];
          if (shop) {
            doc.shopName = shop.shop;
            doc.shopCode = shop.shopCode;
          }
        }
        if (rec.remarks) {
          const by = rec.remarks[rec.remarks.length - 1]?.by;

          //console.log(by);

          const admin = adminStore[by];
          const emp = empStore[by];
          if (emp) {
            doc.remarksBy = emp.name;
          }
          if (admin) {
            doc.remarksBy = admin.name;
          }
        }
        newRecords.push(doc);
      } else if (docs === undefined) {
        if (rec.approvedBy) {
          const doc = {
            ...rec.toObject(),
          };
          const id = rec.approvedBy.jobProfileId?._id + "";

          const shop = shopStore[id];
          if (shop) {
            doc.shopName = shop.shop;
            doc.shopCode = shop.shopCode;
          }
          newRecords.push(doc);
        } else {
          newRecords.push(rec);
        }
      } else {
        newRecords.push(rec);
      }
    }
    resp.status(200).json({
      success: true,
      message: "Employee punches fetched successfully.",
      attendanceRecords: newRecords,
      documnetLength: documnetLength,
    });
  }
  // }
);

export const singleEmployeeAttendance = catchErrorAsync(
  async (
    req: CustomRequest<EmployeeDocument>,
    resp: Response,
    next: NextFunction
  ) => {
    let { date, nextDate } = req.query;
    let { employeeId } = req.params;
    let employee = await EmployeeModel.findOne({ _id: employeeId });
    if (!employee) {
      return resp.status(404).json({
        success: false,
        message: "Employee not found .",
      });
    }
    let filterDate;
    let nextDay;
    if (typeof date === "string") {
      filterDate = new Date(date);
      filterDate.setHours(0, 0, 0, 0);
      filterDate.setHours(filterDate.getHours() - 6);
    } else {
      filterDate = new Date();
      filterDate.setHours(0, 0, 0, 0);
      filterDate.setHours(filterDate.getHours() - 6);
    }
    if (typeof nextDate === "string") {
      nextDay = new Date(nextDate);
      nextDay.setHours(0, 0, 0, 0);
      nextDay.setDate(nextDay.getDate() + 2);
    } else {
      nextDay = new Date(filterDate);
      nextDay.setDate(filterDate.getDate() + 2);
      nextDay.setHours(0, 0, 0, 0);
    }
    filterDate = getIndianTime(filterDate);
    nextDay = getIndianTime(nextDay);

    const data = await v2AttendanceModel
      .find({
        employeeId: employee._id,
        date: {
          $gte: filterDate,
          $lt: nextDay,
        },
      })
      .sort({ date: -1 })
      .exec();
    resp.status(200).json({
      success: true,
      message: "Getting all attendance successfully.",
      data,
    });
  }
);

export const myAttendance = catchErrorAsync(
  async (
    req: CustomRequest<EmployeeDocument>,
    resp: Response,
    next: NextFunction
  ) => {
    if (req.employee) {
      let { date, nextDate } = req.query;
      let filterDate;
      let nextDay;
      if (typeof date === "string") {
        filterDate = new Date(date);
        filterDate.setHours(0, 0, 0, 0);
        filterDate.setHours(filterDate.getHours() - 6);
      } else {
        filterDate = new Date();
        filterDate.setHours(0, 0, 0, 0);
        filterDate.setHours(filterDate.getHours() - 6);
      }
      if (typeof nextDate === "string") {
        nextDay = new Date(nextDate);
        nextDay.setHours(0, 0, 0, 0);
        nextDay.setDate(nextDay.getDate() + 2);
      } else {
        nextDay = new Date(filterDate);
        nextDay.setDate(filterDate.getDate() + 2);
        nextDay.setHours(0, 0, 0, 0);
      }
      filterDate = getIndianTime(filterDate);
      nextDay = getIndianTime(nextDay);
      const data = await v2AttendanceModel
        .find({
          employeeId: req.employee._id,
          date: {
            $gte: filterDate,
            $lt: nextDay,
          },
        })
        .sort({ date: -1 })
        .populate("approvedBy")
        .exec();
      resp.status(200).json({
        success: true,
        message: "Getting all attendance successfully.",
        data,
      });
    } else {
      return next(new ErrorHandler("Login as employee", 404));
    }
  }
);
export const getPunchRecords = catchErrorAsync(
  async (
    req: CustomRequest<EmployeeDocument>,
    resp: Response,
    next: NextFunction
  ) => {
    if (req.admin || req.employee) {
      const { date, nextDate } = req.query;

      let nextDay: any;
      let filterDate: any;
      let date1: any;
      if (typeof date === "string") {
        filterDate = new Date(date);
        filterDate.setHours(0, 0, 0, 0);
        // filterDate.setHours(filterDate.getHours() - 6);
      } else {
        filterDate = new Date();
        filterDate.setHours(0, 0, 0, 0);
        // filterDate.setHours(filterDate.getHours() - 6);
      }
      if (typeof nextDate === "string") {
        nextDay = new Date(nextDate);
        nextDay.setHours(0, 0, 0, 0);
        nextDay.setDate(nextDay.getDate() + 1);
        // nextDay.setHours(nextDay.getHours() - 6);
      } else {
        nextDay = new Date(filterDate);
        nextDay.setDate(filterDate.getDate() + 1);
        nextDay.setHours(0, 0, 0, 0);
        // nextDay.setHours(nextDay.getHours() - 6);
      }
      date1 = getIndianTime(filterDate);
      nextDay = getIndianTime(nextDay);
      const punchIn: any[] = [];
      const punchOut: any[] = [];
      let countIn = 0;
      let countOut = 0;
      const jobProfile = await JobProfileModel.findOne({
        _id: req.employee?.jobProfileId,
      });

      if (
        jobProfile?.jobProfileName.toLowerCase() === "security" ||
        jobProfile?.jobProfileName.toLowerCase() === "security head"
      ) {
        const allData: any[] = await v2AttendanceModel
          .find({
            date: {
              $gte: date1,
              $lt: nextDay,
            },
          })
          .populate("employeeId")
          .populate("approvedBy")
          .exec();

        for (let data of allData) {
          for (let punch of data.punches) {
            if (
              punch.punchInBy?.toString() ===
              (req.employee?._id?.toString() || req.admin?._id?.toString())
            ) {
              const emp = { employee: data.employeeId, punchIn: punch.punchIn };
              punchIn.push(emp);
              countIn++;
            }

            if (
              punch.punchOutBy?.toString() ===
              (req.employee?._id?.toString() || req.admin?._id?.toString())
            ) {
              const emp = {
                employee: data.employeeId,
                punchOut: punch.punchOut,
              };
              punchOut.push(emp);
              countOut++;
            }
          }
        }

        resp.status(200).json({
          success: true,
          message: "All attendance successfully security.",
          punchIn,
          punchOut,
          countIn,
          countOut,
        });
      } else if (jobProfile?.jobProfileName === "hr" || req.admin) {
        let totalPresent = 0;
        const totalEmployees = await EmployeeModel.countDocuments();
        const allData: any[] = await v2AttendanceModel
          .find({
            date: {
              $gte: date1,
              $lt: nextDay,
            },
          })
          .populate("employeeId")
          .populate("punches.punchInBy")
          .populate("punches.punchOutBy")
          .populate("approvedBy")
          .exec();
        totalPresent = allData.length;
        for (let data of allData) {
          for (let punch of data.punches) {
            if (punch.punchIn) {
              const emp = {
                employee: data.employeeId,
                punchIn: punch.punchIn,
                punchInBy: punch.punchInBy,
              };
              punchIn.push(emp);
            }

            if (punch.punchOut) {
              const emp = {
                employee: data.employeeId,
                punchOut: punch.punchOut,
                punchOutBy: punch.punchOutBy,
              };
              punchOut.push(emp);
            }
          }
        }

        resp.status(200).json({
          success: true,
          message: "All attendance successfully.",
          punchIn,
          punchOut,
          countIn: punchIn.length,
          countOut: punchOut.length,
          totalEmployees,
          totalPresent,
        });
      } else {
        let totalEmployees = 0;
        let totalPresent = 0;
        const employeeIds = await EmployeeModel.aggregate([
          {
            $lookup: {
              from: "jobprofiles",
              localField: "jobProfileId",
              foreignField: "_id",
              as: "jobProfile",
            },
          },
          {
            $unwind: "$jobProfile",
          },
          {
            $match: {
              "jobProfile.parentJobProfileId": jobProfile?._id,
            },
          },
        ]).exec();

        const ids = employeeIds.map((employee) => employee._id);

        totalEmployees = ids.length;
        const allData: any[] = await v2AttendanceModel
          .find({
            date: {
              $gte: date1,
              $lt: nextDay,
            },
            employeeId: { $in: ids },
          })
          .populate("employeeId")
          .populate("approvedBy")
          .populate("punches.punchInBy")
          .populate("punches.punchOutBy")
          .exec();

        totalPresent = allData.length;
        for (let data of allData) {
          for (let punch of data.punches) {
            if (punch.punchIn) {
              const emp = {
                employee: data.employeeId,
                punchIn: punch.punchIn,
                punchInBy: punch.punchInBy,
              };
              punchIn.push(emp);
            }

            if (punch.punchOut) {
              const emp = {
                employee: data.employeeId,
                punchOut: punch.punchOut,
                punchOutBy: punch.punchOutBy,
              };
              punchOut.push(emp);
            }
          }
        }

        resp.status(200).json({
          success: true,
          message: "All attendance successfully.",
          punchIn,
          punchOut,
          countIn: punchIn.length,
          countOut: punchOut.length,
          totalEmployees,
          totalPresent,
        });
      }
    } else {
      return next(new ErrorHandler("Login first", 403));
    }
  }
);

export const employeeStaffAttendance = catchErrorAsync(
  async (
    req: CustomRequest<EmployeeDocument>,
    resp: Response,
    next: NextFunction
  ) => {
    if (req.employee || req.admin) {
      let employee: EmployeeDocument | null = null;
      let jobProfile: JobProfileDocument | null = null;

      let { date, nextDate } = req.query;

      if (req.employee) {
        employee = await EmployeeModel.findById(req.employee._id).exec();
        if (!employee) {
          resp.status(404).json({
            success: false,
            message: "Employee not found",
          });
        }

        jobProfile = await JobProfileModel.findById(employee?.jobProfileId);
        if (!jobProfile) {
          resp.status(404).json({
            success: false,
            message: "Job profile not found",
          });
        }
      }
      let filterDate;
      let nextDay;
      if (typeof date === "string") {
        filterDate = new Date(date);
        filterDate.setHours(0, 0, 0, 0);
        filterDate.setHours(filterDate.getHours() - 6);
      } else {
        filterDate = new Date();
        filterDate.setHours(0, 0, 0, 0);
        filterDate.setHours(filterDate.getHours() - 6);
      }
      if (typeof nextDate === "string") {
        nextDay = new Date(nextDate);
        nextDay.setHours(0, 0, 0, 0);
        nextDay.setDate(nextDay.getDate() + 2);
      } else {
        nextDay = new Date(filterDate);
        nextDay.setDate(filterDate.getDate() + 2);
        nextDay.setHours(0, 0, 0, 0);
      }

      const isHR = jobProfile?.jobProfileName.toLowerCase() === "hr";
      const isAdmin = req.admin;

      if (!isHR && !isAdmin) {
        const myJobProfile = await JobProfileModel.findOne({
          _id: jobProfile?._id,
        });
        const childJobProfile = myJobProfile?.childProfileId;
        const data = [];
        if (childJobProfile) {
          for (let jobProfile of childJobProfile) {
            const thisJobProfile = await JobProfileModel.findOne({
              _id: jobProfile,
            });
            const employees = await EmployeeModel.find({
              jobProfileId: jobProfile,
            });
            const totalEmployees = employees.length;
            const ids: any = employees.map((employee) => employee._id);
            const attendanceRecords = await v2AttendanceModel
              .find({
                employeeId: { $in: ids },
                date: {
                  $gte: filterDate,
                  $lt: nextDay,
                },
              })
              .sort({ date: -1 })
              .populate("employeeId")
              .populate("approvedBy")
              .populate({
                path: "employeeId",
                populate: {
                  path: "jobProfileId",
                },
              })

              .exec();
            const todayPresent = attendanceRecords.length;
            const dataa = {
              todayPresent,
              totalEmployees,
              thisJobProfile,
            };
            data.push(dataa);
          }
        }

        resp.status(200).json({
          success: true,
          message: "Employee punches fetched successfully.",
          data,
        });
      }
    } else {
      return next(new ErrorHandler("Login first", 404));
    }
  }
);

export const getGroupPunchRecords = catchErrorAsync(
  async (
    req: CustomRequest<EmployeeDocument>,
    resp: Response,
    next: NextFunction
  ) => {
    if (req.admin || req.employee) {
      const { date, nextDate } = req.query;
      const employeeStore: any = {};
      const attendanceStore: any = {};

      let filterDate;
      let nextDay;
      if (typeof date === "string") {
        filterDate = new Date(date);
        filterDate.setHours(0, 0, 0, 0);
        filterDate.setHours(filterDate.getHours() - 6);
      } else {
        filterDate = new Date();
        filterDate.setHours(0, 0, 0, 0);
        filterDate.setHours(filterDate.getHours() - 6);
      }
      if (typeof nextDate === "string") {
        nextDay = new Date(nextDate);
        nextDay.setHours(0, 0, 0, 0);
        nextDay.setDate(nextDay.getDate() + 2);
        nextDay.setHours(nextDay.getHours() - 11.5);
      } else {
        nextDay = new Date(filterDate);
        nextDay.setDate(filterDate.getDate() + 2);
        nextDay.setHours(0, 0, 0, 0);
        nextDay.setHours(nextDay.getHours() - 11.5);
      }

      const allEmployee = await EmployeeModel.find({});
      const allAttendance = await v2AttendanceModel
        .find({
          date: {
            $gte: filterDate,
            $lt: nextDay,
          },
        })
        .populate("approvedBy")
        .exec();

      allEmployee.forEach((e) => {
        const id = e.groupId + "";
        if (!employeeStore[id]) {
          employeeStore[id] = {
            value: [],
          };
        }
        employeeStore[id].value.push({
          ...e.toObject(),
        });
      });

      allAttendance.forEach((a) => {
        const id = a.employeeId + "";
        attendanceStore[id] = {
          ...a.toObject(),
        };
      });

      const jobProfile = await JobProfileModel.findOne({
        _id: req.employee?.jobProfileId,
      });

      if (req.admin || jobProfile?.jobProfileName.toLowerCase() === "hr") {
        const groups = await groupModel.find();

        const groupPresent = [];
        for (let group of groups) {
          const punchIn: any[] = [];
          const punchOut: any[] = [];
          const groupId = group._id + "";
          const employees = employeeStore[groupId];

          if (employees) {
            let count = 0;
            const ids = employees.value.map((employee: any) => employee._id);

            ids.forEach((i: any) => {
              const id = i;
              const data = attendanceStore[id];
              if (data) {
                count++;
                for (let punch of data.punches) {
                  if (punch.punchInBy) {
                    const emp = {
                      employee: data.employeeId,
                      punchIn: punch.punchIn,
                    };
                    punchIn.push(emp);
                  }
                  if (punch.punchOutBy) {
                    const emp = {
                      employee: data.employeeId,
                      punchOut: punch.punchOut,
                    };
                    punchOut.push(emp);
                  }
                }
              }
            });

            const obj = {
              present: count,
              punchIn,
              punchOut,
              groupName: group.groupName,
              totalEmployeesInGroup: ids.length,
            };
            groupPresent.push(obj);
          }
        }
        resp.status(200).json({
          success: true,
          message: "All attendance successfully.",
          groupPresent,
        });
      }
    } else {
      return next(new ErrorHandler("Login first", 403));
    }
  }
);
export const getEmployeeByQRCode = catchErrorAsync(
  async (
    req: CustomRequest<EmployeeDocument>,
    resp: Response,
    next: NextFunction
  ) => {
    let jobProfile;
    // checking the jobProfile Name
    if (req.employee) {
      jobProfile = await JobProfileModel.findById({
        _id: req.employee.jobProfileId,
      });
    }

    const { data, shift } = req.body;
    // console.log(new Date() , new Date() +"");
    let qrCode;
    try {
      qrCode = await QRCode.toDataURL(data); // Using email as an example
    } catch (err) {
      return next(new ErrorHandler("QR Code generation failed.", 500));
    }
    if (
      req.admin ||
      jobProfile?.isSupervisor ||
      jobProfile?.jobProfileName.toLowerCase() === "hr" ||
      jobProfile?.jobProfileName.toLowerCase() === "security head" ||
      jobProfile?.jobProfileName.toLowerCase() === "security"
    ) {
      let employee = await EmployeeModel.findOne({ currentBarCode: qrCode })
        .populate("jobProfileId")
        .populate("groupId");

      let employee1 = await EmployeeModel.findOne({ permanentBarCode: qrCode })
        .populate("jobProfileId")
        .populate("groupId");

      if (!employee && !employee1) {
        return next(new ErrorHandler("Employee not found.", 404));
      }
      if (
        employee?.BarCodeStatus === false ||
        employee1?.BarCodeStatus === false
      ) {
        return next(new ErrorHandler("Employee not active.", 404));
      }

      if (employee1) {
        employee = employee1;
      }

      if (!employee) {
        return resp.status(404).json({
          success: false,
          message: "Employee Not found.",
        });
      }
      const id = employee._id;
      // console.log(employee?._id,employee1?._id)

      let docs = await EmployeeDocsModel.findOne({ employeeId: id });

      let nextDay;
      let date = new Date();
      date.setHours(0, 0, 0, 0);
      // date.setHours(date.getHours() +5.5);
      if (shift === "night") {
        date.setHours(date.getHours() - 6);
      }

      nextDay = new Date(date);
      nextDay.setDate(nextDay.getDate() + 3);
      nextDay.setHours(0, 0, 0, 0);
      nextDay.setHours(nextDay.getHours() - 11.5);
      console.log("scan employee..............", date, nextDay);
      let atten: AttendanceDocs[] | null = await v2AttendanceModel
        .find({
          employeeId: id,
          date: {
            $gte: date,
            $lt: nextDay,
          },
          shift,
        })
        .populate("approvedBy")
        .exec();

      let attendanceId = atten[atten.length - 1]?._id;
      let attendanceRecord = await v2AttendanceModel.findById(attendanceId);
      let message = "";
      let length = attendanceRecord?.punches
        ? attendanceRecord?.punches.length - 1
        : 0;
      if (attendanceRecord) {
        let attendanceDate = new Date(attendanceRecord.date);
        const time = new Date(attendanceDate).getUTCHours(); // 8   10      // 11  10
        if (shift === "night") {
          //true &&true  &&  true  || true &&
          const lastPunchIn: any = attendanceRecord.punches[length];
          const currentTime: any = getIndianTime(new Date());
          const lastPnch: any = lastPunchIn.punchIn;
          // checking for punch out if punch in before 1 min
          const diff = currentTime - lastPnch;
          console.log("-------", lastPnch, currentTime);
          const timed = diff / (1000 * 60);
          let min = timed;
          if (
            (time > 18 &&
              new Date().getDate() !== attendanceDate.getUTCDate() &&
              new Date().getHours() > 18) ||
            (attendanceDate.getUTCDate() === new Date().getDate() &&
              attendanceDate.getUTCHours() < 18 &&
              new Date().getHours() > 18)
          ) {
            message = "Punch In";
          } else if (attendanceRecord.punches[length].punchOut) {
            message = "Punch In";
          } else {
            if (min < 1) {
              message = "Punch Out after 1 min";
            } else {
              message = "Punch Out";
            }
          }
        } else {
          const lastPunchIn: any = attendanceRecord.punches[length];
          const currentTime: any = getIndianTime(new Date());
          const lastPnch: any = lastPunchIn.punchIn;
          // checking for punch out if punch in before 1 min
          const diff = currentTime - lastPnch;
          console.log("-------", lastPnch, currentTime);
          const timed = diff / (1000 * 60);
          let min = timed;
          if (attendanceRecord.punches[length].punchOut) {
            message = "Punch In";
          } else {
            if (min < 1) {
              message = "Punch Out after 1 min";
            } else {
              message = "Punch Out";
            }
          }
        }
      } else {
        message = "Punch In";
      }

      let profilePicture;
      if (docs) {
        profilePicture = docs.profilePicture;
      }

      resp.status(200).json({
        success: true,
        message: "getting employee data successfully.",
        employee,
        profilePicture: profilePicture,
        docs: docs,
        punch: message,
        attendanceRecord,
      });
    } else {
      resp.status(200).json({
        success: false,
        message: "Login first as Security .",
      });
    }
  }
);

export const getMyApprovedAttendance = catchErrorAsync(
  async (
    req: CustomRequest<EmployeeDocument>,
    resp: Response,
    next: NextFunction
  ) => {
    let emp;
    let { date, nextDate, groupName, shift } = req.query;
    let filterDate;
    let nextDay;

    if (typeof date === "string") {
      filterDate = new Date(date);
      filterDate.setHours(0, 0, 0, 0);
      filterDate.setHours(filterDate.getHours() - 6);
    } else {
      filterDate = new Date();
      filterDate.setHours(0, 0, 0, 0);
      filterDate.setHours(filterDate.getHours() - 6);
    }

    if (typeof nextDate === "string") {
      nextDay = new Date(nextDate);
      // nextDay.setHours(0, 0, 0, 0);
      nextDay.setDate(nextDay.getDate() + 1);
      nextDay.setHours(nextDay.getHours() + 6);
    } else {
      nextDay = new Date(filterDate);
      nextDay.setDate(filterDate.getDate() + 1);
      // nextDay.setHours(0, 0, 0, 0);
      nextDay.setHours(nextDay.getHours() + 6);
    }

    let data: any;
    if (req.employee) {
      emp = await EmployeeModel.findById(req.employee._id);
      let filter: any = {};
      if (groupName) {
        const groups = await groupModel.find({ groupName: { $in: groupName } });
        const groupIds = groups.map((e) => e._id);
        const empGroup = await EmployeeModel.find({
          groupId: { $in: groupIds },
        });
        const empgroupIds = empGroup.map((a) => a._id);
        filter.employeeId = { $in: empgroupIds };
      }
      if (shift) {
        filter.shift = shift;
      }

      filter.approvedBy = emp?._id;

      data = await v2AttendanceModel
        .find({ ...filter, date: { $gte: date, $lt: nextDay } })
        .populate({
          path: "approvedBy",
          select: { name: 1 },
        })
        .populate({
          path: "employeeId",
          select: { name: 1, employeeCode: 1, groupId: 1 },
          populate: [
            {
              path: "jobProfileId",
              select: "jobProfileName",
            },
            {
              path: "groupId",
              select: "groupName",
            },
          ],
        })
        .exec();
    }

    data.sort((a: any, b: any) =>
      a.employeeId.name.localeCompare(b.employeeId.name)
    );
    resp.status(200).json({
      success: true,
      message: "attendance successfully.",
      total: data.length,
      data: data,
    });
  }
);

export const addPunchs = catchErrorAsync(
  async (
    req: CustomRequest<EmployeeDocument>,
    resp: Response,
    next: NextFunction
  ) => {
    if (req.admin) {
      let { id } = req.params;
      let { punchIn, punchOut, date, remarks, shift } = req.body;
      let employee = await EmployeeModel.findById(id);
      if (!employee) {
        resp.status(400).json({
          success: false,
          message: "Employee not found.",
        });
      }
      let nextDay;
      date = new Date(date);
      date.setHours(0, 0, 0, 0);
      date.setHours(date.getHours() - 11.5);
      // date.setHours(date.getHours() - 6);

      nextDay = new Date(date);
      nextDay.setDate(nextDay.getDate() + 1);
      nextDay.setHours(0, 0, 0, 0);
      nextDay.setHours(nextDay.getHours() - 11.5);
      // nextDay.setHours(nextDay.getHours() - 6);

      date = getIndianTime(date);
      nextDay = getIndianTime(nextDay);
      const attendanceRecord = await v2AttendanceModel.find({
        employeeId: employee?._id,
        date: {
          $gte: date,
          $lt: nextDay,
        },
      });
      if (attendanceRecord.length === 0) {
        let obj: any;
        const remark = [
          {
            remark: remarks,
            createdAt: Date.now(),
            by: req.admin._id,
          },
        ];
        if (punchOut && punchIn) {
          obj = [
            {
              punchIn: punchIn,
              punchOut: punchOut,
              employeeId: employee?._id,
              punchInBy: req.admin._id,
              punchOutBy: req.admin._id,
            },
          ];
        } else if (punchIn && !punchOut) {
          obj = [
            {
              punchIn: punchIn,
              punchOut: punchOut,
              employeeId: employee?._id,
              punchInBy: req.admin._id,
              punchOutBy: null,
            },
          ];
        } else if (!punchIn && !punchOut) {
          resp.status(400).json({
            success: false,
            message: "add punches record failed",
          });
        }
        const createRecord = await v2AttendanceModel.create({
          employeeId: employee?._id,
          date: punchIn,
          remarks: remark,
          shift: shift,
          status: "added Manually by administrator",
          punches: obj,
        });

        resp.status(200).json({
          success: true,
          createRecord,
          message: "record created successfully",
        });
      } else {
        resp.status(400).json({
          success: false,
          message: "Record found successfully.",
        });
      }
    } else if (req.attendanceManager) {
      let { id } = req.params;
      let { punchIn, punchOut, date, remarks, shift } = req.body;
      let employee = await EmployeeModel.findById(id);
      if (!employee) {
        resp.status(400).json({
          success: false,
          message: "Employee not found.",
        });
      }
      let nextDay;
      date = new Date(date);
      date.setHours(0, 0, 0, 0);
      date.setHours(date.getHours() - 11.5);
      // date.setHours(date.getHours() - 6);

      nextDay = new Date(date);
      nextDay.setDate(nextDay.getDate() + 1);
      nextDay.setHours(0, 0, 0, 0);
      nextDay.setHours(nextDay.getHours() - 11.5);
      // nextDay.setHours(nextDay.getHours() - 6);

      date = getIndianTime(date);
      nextDay = getIndianTime(nextDay);
      const attendanceRecord = await v2AttendanceModel.find({
        employeeId: employee?._id,
        date: {
          $gte: date,
          $lt: nextDay,
        },
      });
      if (attendanceRecord.length === 0) {
        let obj: any;
        const remark = [
          {
            remark: remarks,
            createdAt: Date.now(),
            by: req.attendanceManager._id,
          },
        ];
        if (punchOut && punchIn) {
          obj = [
            {
              punchIn: punchIn,
              punchOut: punchOut,
              employeeId: employee?._id,
              punchInBy: req.attendanceManager._id,
              punchOutBy: req.attendanceManager._id,
            },
          ];
        } else if (punchIn && !punchOut) {
          obj = [
            {
              punchIn: punchIn,
              punchOut: punchOut,
              employeeId: employee?._id,
              punchInBy: req.attendanceManager._id,
              punchOutBy: null,
            },
          ];
        } else if (!punchIn && !punchOut) {
          resp.status(400).json({
            success: false,
            message: "add punches record failed",
          });
        }
        const createRecord = await v2AttendanceModel.create({
          employeeId: employee?._id,
          date: punchIn,
          remarks: remark,
          shift: shift,
          status: "added Manually by administrator",
          punches: obj,
        });

        resp.status(200).json({
          success: true,
          createRecord,
          message: "record created successfully",
        });
      } else {
        resp.status(400).json({
          success: false,
          message: "Record found successfully.",
        });
      }
    } else {
      resp.status(400).json({
        success: false,
        message: "Login first as admin or attendance manager ",
      });
    }
  }
);
export const updatePunchs = catchErrorAsync(
  async (
    req: CustomRequest<EmployeeDocument>,
    resp: Response,
    next: NextFunction
  ) => {
    if (req.admin) {
      let { id } = req.params;
      let { punchIn, punchOut, date, remarks, shift } = req.body;
      let employee = await EmployeeModel.findById(id);
      if (!employee) {
        resp.status(400).json({
          success: false,
          message: req.admin._id,
        });
      }

      const attendanceRecord = await v2AttendanceModel.findOne({
        employeeId: employee?._id,
        date: date,
      });
      if (attendanceRecord) {
        const obj = [
          {
            punchIn: punchIn,
            punchOut: punchOut,
            employeeId: employee?._id,
            punchInBy: req.admin._id,
          },
        ];
        const remark = [
          {
            remark: remarks,
            createdAt: Date.now(),
            by: req.admin._id,
          },
        ];
        const updateAttendance = await v2AttendanceModel.findByIdAndUpdate(
          attendanceRecord._id,
          {
            shift: shift,
            $push: { remarks: remark },
            punches: obj,
            status: "added Manually by administrator",
          },
          { new: true }
        );

        resp.status(200).json({
          success: true,
          updateAttendance,
          message: "record updated successfully",
        });
      } else {
        resp.status(400).json({
          success: false,
          message: "Record not found create new.",
        });
      }
    } else if (req.attendanceManager) {
      let { id } = req.params;
      let { punchIn, punchOut, date, remarks, shift } = req.body;
      let employee = await EmployeeModel.findById(id);
      if (!employee) {
        resp.status(400).json({
          success: false,
          message: req.attendanceManager._id,
        });
      }

      const attendanceRecord = await v2AttendanceModel.findOne({
        employeeId: employee?._id,
        date: date,
      });
      if (attendanceRecord) {
        const obj = [
          {
            punchIn: punchIn,
            punchOut: punchOut,
            employeeId: employee?._id,
            punchInBy: req.attendanceManager._id,
          },
        ];
        const remark = [
          {
            remark: remarks,
            createdAt: Date.now(),
            by: req.attendanceManager._id,
          },
        ];
        const updateAttendance = await v2AttendanceModel.findByIdAndUpdate(
          attendanceRecord._id,
          {
            shift: shift,
            $push: { remarks: remark },
            punches: obj,
            status: "added Manually by administrator",
          },
          { new: true }
        );

        resp.status(200).json({
          success: true,
          updateAttendance,
          message: "record updated successfully",
        });
      } else {
        resp.status(400).json({
          success: false,
          message: "Record not found create new.",
        });
      }
    } else {
      resp.status(400).json({
        success: false,
        message: "Login first as admin",
      });
    }
  }
);
export const deletePunchs = catchErrorAsync(
  async (
    req: CustomRequest<EmployeeDocument>,
    resp: Response,
    next: NextFunction
  ) => {
    if (req.admin) {
      let { id } = req.params;
      let { punchsId } = req.query;
      let employee = await EmployeeModel.findById(id);
      if (!employee) {
        resp.status(400).json({
          success: false,
          message: "Employee not found.",
        });
      }

      const attendanceRecords = await v2AttendanceModel.find({
        employeeId: employee?._id,
      });

      if (attendanceRecords.length === 0) {
        resp.status(400).json({
          success: false,
          message: "Record not found create new.",
        });
        return;
      }

      for (const record of attendanceRecords) {
        record.punches = record.punches.filter((item: any) => {
          return item._id.toString() !== punchsId;
        });

        if (record.punches.length === 0) {
          await v2AttendanceModel.findOneAndDelete({ _id: record._id });
        } else {
          await record.save();
        }
      }

      resp.status(200).json({
        success: true,
        message: "Record deleted successfully",
      });
    } else if (req.attendanceManager) {
      let { id } = req.params;
      let { punchsId } = req.query;
      let employee = await EmployeeModel.findById(id);
      if (!employee) {
        resp.status(400).json({
          success: false,
          message: "Employee not found.",
        });
      }

      const attendanceRecords = await v2AttendanceModel.find({
        employeeId: employee?._id,
      });

      if (attendanceRecords.length === 0) {
        resp.status(400).json({
          success: false,
          message: "Record not found create new.",
        });
        return;
      }

      for (const record of attendanceRecords) {
        record.punches = record.punches.filter((item: any) => {
          return item._id.toString() !== punchsId;
        });

        if (record.punches.length === 0) {
          await v2AttendanceModel.findOneAndDelete({ _id: record._id });
        } else {
          await record.save();
        }
      }

      resp.status(200).json({
        success: true,
        message: "Record deleted successfully",
      });
    } else {
      resp.status(400).json({
        success: false,
        message: "Login first as admin",
      });
    }
  }
);

export const shopFilter = catchErrorAsync(
  async (
    req: CustomRequest<EmployeeDocument>,
    resp: Response,
    next: NextFunction
  ) => {
    let {
      date,
      shopNames,
      groupNames,
      nextDate,
      limit = 20,
      page = 1,
    } = req.body;
    limit = +limit;
    page = +page;
    const skip = (page - 1) * limit;
    let filterDate;
    let nextDay;
    if (typeof date === "string") {
      filterDate = new Date(date);
      filterDate.setHours(0, 0, 0, 0);
      // filterDate.setHours(filterDate.getHours() - 6);
    } else {
      filterDate = new Date();
      filterDate.setHours(0, 0, 0, 0);
      // filterDate.setHours(filterDate.getHours() - 6);
    }
    if (typeof nextDate === "string") {
      nextDay = new Date(nextDate);
      nextDay.setHours(0, 0, 0, 0);
      nextDay.setDate(nextDay.getDate() + 1);
      // nextDay.setHours(nextDay.getHours() - 6);
    } else {
      nextDay = new Date(filterDate);
      nextDay.setDate(filterDate.getDate() + 1);
      nextDay.setHours(0, 0, 0, 0);
      // nextDay.setHours(nextDay.getHours() - 6);
    }
    let filter: any = {};
    if (shopNames.length > 0) {
      const shops = await ShopModel.find({ shopName: { $in: shopNames } });
      const jobProfileIdsUnderShop = shops.map(
        (shop) => shop.jobProfile.jobProfileId
      );
      const jobprofile = await JobProfileModel.find({
        _id: { $in: jobProfileIdsUnderShop },
      });
      const jobprofileIds = jobprofile.map((job) => job._id);
      const employee = await EmployeeModel.find({
        jobProfileId: { $in: jobprofileIds },
      });
      const empIds = employee.map((e) => e._id);

      filter.approvedBy = { $in: empIds };
    }

    if (groupNames.length > 0) {
      const groups = await groupModel.find({ groupName: { $in: groupNames } });
      const groupIds = groups.map((e) => e._id);
      const empGroup = await EmployeeModel.find({ groupId: { $in: groupIds } });
      const empgroupIds = empGroup.map((a) => a._id);
      filter.employeeId = { $in: empgroupIds };
    }
    if (shopNames.length === 0 && groupNames.length === 0) {
      filter.status = { $in: "approved" };
    }
    const attendance1 = await v2AttendanceModel.find({
      ...filter,

      date: {
        $gte: filterDate,
        $lt: nextDay,
      },
    });
    const attendance: any = await v2AttendanceModel
      .find({
        ...filter,
        date: {
          $gte: filterDate,
          $lt: nextDay,
        },
      })
      .skip(skip)
      .limit(limit)
      .sort({ date: -1 })
      .populate({
        path: "employeeId",
        select: { name: 1, employeeCode: 1, jobProfileId: 1, group: 1 },
        populate: {
          path: "jobProfileId",
          select: "jobProfileName",
        },
      })
      .populate({
        path: "employeeId",
        select: { name: 1, employeeCode: 1, jobProfileId: 1, group: 1 },
        populate: {
          path: "groupId",
          select: "groupName",
        },
      })
      .populate({
        path: "approvedBy",
        select: "name",
        populate: {
          path: "jobProfileId",
          select: "jobProfileName",
        },
      });
    const allShop = await ShopModel.find();
    let shopStore: any = {};
    allShop.forEach((a) => {
      const id = a.jobProfile.jobProfileId + "";
      shopStore[id] = {
        shopId: a._id,
        shop: a.shopName,
        shopCode: a.shopCode,
      };
    });
    let newRecords = [];
    for (let rec of attendance) {
      if (rec.approvedBy) {
        const doc: any = {
          ...rec.toObject(),
        };
        const id: any = rec.approvedBy.jobProfileId?._id + "";
        const shop = shopStore[id];
        if (shop) {
          doc.shopName = shop.shop;
          doc.shopCode = shop.shopCode;
        }
        newRecords.push(doc);
      } else {
        newRecords.push(rec);
      }
    }

    resp.status(200).json({
      success: 200,
      message: "Shop(s) found successfully",
      total: attendance1.length,
      attendance: newRecords,
    });
  }
);
export const pendingUnderMe = catchErrorAsync(
  async (
    req: CustomRequest<EmployeeDocument>,
    resp: Response,
    next: NextFunction
  ) => {
    let {
      date,
      nextDate,
      page = 1,
      limit = 100,
    } = req.query as {
      date?: string;
      nextDate?: string;
      page?: number;
      limit?: number;
    };
    limit = +limit;
    page = +page;
    const skip = (page - 1) * limit;
    let filterDate;
    let nextDay;
    if (typeof date === "string") {
      filterDate = new Date(date);
      filterDate.setHours(0, 0, 0, 0);
      // filterDate.setHours(filterDate.getHours() - 6);
    } else {
      filterDate = new Date();
      filterDate.setHours(0, 0, 0, 0);
      // filterDate.setHours(filterDate.getHours() - 6);
    }
    if (typeof nextDate === "string") {
      nextDay = new Date(nextDate);
      nextDay.setHours(0, 0, 0, 0);
      nextDay.setDate(nextDay.getDate() + 1);
      // nextDay.setHours(nextDay.getHours() - 6);
    } else {
      nextDay = new Date(filterDate);
      nextDay.setDate(filterDate.getDate() + 1);
      nextDay.setHours(0, 0, 0, 0);
      // nextDay.setHours(nextDay.getHours() - 6);
    }
    if (req.employee) {
      const employee = await EmployeeModel.findOne({ _id: req.employee._id });
      if (employee) {
        const jobProfileName = await JobProfileModel.findOne({
          _id: employee.jobProfileId,
        });
        const childJobProfile = jobProfileName?.childProfileId;
        // find employess of childJobProfile
        const employeeProfile = await EmployeeModel.find({
          jobProfileId: childJobProfile,
        }).select({ name: 1, employeeCode: 1, jobProfileId: 1 });
        const attendance = await v2AttendanceModel
          .find({
            employeeId: {
              $in: employeeProfile.map((employee) => employee._id),
            },
            date: {
              $gte: filterDate,
              $lt: nextDay,
            },
          })
          .skip(skip)
          .limit(limit)
          .sort({ date: -1 })
          .populate({
            path: "employeeId",
            select: { name: 1, employeeCode: 1 },
            populate: {
              path: "jobProfileId",
              select: "jobProfileName",
            },
          });
        resp.status(200).json({
          success: true,
          total: attendance.length,
          childJobProfile,
          attendance,
          message: "Shop not found",
        });
      }
    }
  }
);
export const addAttendanceWithEmployeeIdV2 = catchErrorAsync(
  async (
    req: CustomRequest<EmployeeDocument>,
    resp: Response,
    next: NextFunction
  ) => {
    let jobProfile;
    // checking the jobProfile Name
    if (req.employee) {
      jobProfile = await JobProfileModel.findById(req.employee.jobProfileId);
    }
    let lastPunchOut;
    let lastPunchIn;

    const { id, shift } = req.body;
    let date = new Date();
    let nextDay;
    date = new Date(date);
    date.setHours(0, 0, 0, 0); // 12:00 am
    //  console.log("date.........................",date)
    // date.setHours(date.getHours() - 6);
    if (shift === "night") {
      // console.log("in night condition.........................")
      date.setHours(date.getHours() - 6); // 6:00 pm prev day
    }
    // console.log(date,nextDay);
    nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 3);
    nextDay.setHours(0, 0, 0, 0);
    nextDay.setHours(nextDay.getHours() - 11.5);

    console.log(
      "date nextday .................................",
      date,
      nextDay
    );
    let message = ``;
    if (
      req.admin ||
      jobProfile?.jobProfileName.toLowerCase() === "hr" ||
      jobProfile?.jobProfileName.toLowerCase() === "security head" ||
      jobProfile?.jobProfileName.toLowerCase() === "security"
    ) {
      let employee = await EmployeeModel.findOne({ _id: id })
        .populate("jobProfileId")
        .populate("groupId")
        .exec();

      if (!employee) {
        return next(new ErrorHandler("Employee not found.", 404));
      }

      if (employee.BarCodeStatus === false) {
        return next(new ErrorHandler("Employee not active.", 404));
      }

      let currentDate = new Date();
      currentDate = getIndianTime(currentDate);

      let atten: AttendanceDocs[] | null = await v2AttendanceModel.find({
        employeeId: employee?._id,
        date: {
          $gte: date,
          $lt: nextDay,
        },
        shift: shift,
      });
      const attendanceId = atten[atten.length - 1]?._id;
      let attendanceRecord = await v2AttendanceModel.findById(attendanceId);

      if (!attendanceRecord) {
        attendanceRecord = new v2AttendanceModel({
          employeeId: employee?._id,
          date: currentDate,
          shift: shift,
          punches: [
            {
              employeeId: employee?._id,
              punchIn: getIndianTime(new Date()),
              punchInBy: req.employee?._id || req.admin?._id,
            },
          ],
          isPresent: true,
        });
        message = `Attendance punch In successfully.`;
      } else {
        let attDate = new Date(attendanceRecord.date);

        // condition added for night shift
        //  console.log( (currentDate.getDate() === attDate.getDate()
        //  ? attDate.getUTCHours() < 18
        //  : true));
        //  console.log(currentDate.getUTCHours())
        //  console.log(currentDate)
        //  console.log(currentDate.getUTCHours() > 18);
        if (
          (currentDate.getDate() === attDate.getDate()
            ? attDate.getUTCHours() < 18
            : true) &&
          currentDate.getUTCHours() > 18 &&
          shift === "night"
        ) {
          attendanceRecord = new v2AttendanceModel({
            employeeId: employee?._id,
            date: currentDate,
            shift: shift,
            punches: [
              {
                employeeId: employee?._id,
                punchIn: getIndianTime(new Date()),
                punchInBy: req.employee?._id || req.admin?._id,
                status: "pending",
              },
            ],
            isPresent: true,
          });
          await attendanceRecord.save();
          message = `Attendance punch In successfully.`;

          return resp.status(200).json({
            success: true,
            message,
            attendance: attendanceRecord,
            employee,
          });
        }

        const todayAttendance = attendanceRecord.punches;
        if (!todayAttendance) {
          attendanceRecord.punches.push({
            punchIn: getIndianTime(new Date()),
            punchInBy: req.employee?._id || req.admin?._id,
          });
          message = `Attendance punch In successfully.`;
        } else {
          const lastPunch = todayAttendance[todayAttendance.length - 1];
          if (lastPunch && lastPunch.punchOut) {
            const newPunch = {
              employeeId: employee?._id,
              punchIn: getIndianTime(new Date()),
              punchInBy: req.employee?._id || req.admin?._id,
            };

            attendanceRecord.punches.push(newPunch);
            message = `Attendance punch In successfully.1`;
          } else {
            const FirstPunchIn: Date = new Date(
              attendanceRecord.punches[0].punchIn
            );
            FirstPunchIn.setTime(FirstPunchIn.getTime() - 330 * 60 * 1000);

            const lastPunchout: Date = new Date();
            const data = await getProductivityPerEmployee(
              employee._id,
              FirstPunchIn,
              lastPunchout
            );
            if (data) {
              attendanceRecord.productiveHours = data.productiveHours || 0;
              attendanceRecord.productionSlipNumbers =
                data.productionSlipNumbers;
            }

            lastPunch.punchOut = getIndianTime(new Date());
            lastPunch.punchOutBy = req.employee?._id || req.admin?._id;
            const totalWorking: number =
              lastPunch.punchOut.getTime() - FirstPunchIn.getTime();
            attendanceRecord.totalWorking = totalWorking;
            message = `Attendance punch Out successfully.`;
          }
        }
      }

      await attendanceRecord.save();
      resp.status(200).json({
        success: true,
        message,
        attendance: attendanceRecord,
      });
    } else {
      resp.status(200).json({
        success: false,
        message: "Login first as Security or admin or hr.",
      });
    }
  }
);

export const groupOverView = catchErrorAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { date } = req.query;

    let nextDay: any;
    let date1: any;
    if (typeof date === "string") {
      date1 = new Date(date);
      date1.setHours(0, 0, 0, 0);
      // date1.setHours(date1.getHours() - 6);

      nextDay = new Date(date1);
      nextDay.setDate(nextDay.getDate() + 1);
      nextDay.setHours(0, 0, 0, 0);
    } else {
      date1 = new Date();
      date1.setHours(0, 0, 0, 0);
      // date1.setHours(date1.getHours() - 6);

      nextDay = new Date(date1);
      nextDay.setDate(nextDay.getDate() + 1);
      nextDay.setHours(0, 0, 0, 0);
    }
    // date1 = getIndianTime(date1);
    // nextDay = getIndianTime(nextDay);

    const allGroups = await groupModel.find({});
    const groupStore = [];

    for (const group of allGroups) {
      const employees = await EmployeeModel.find({ groupId: group._id })
        .lean()
        .exec();
      const empids = employees.map((employee: any) => employee._id);
      const attendance = await v2AttendanceModel.find({
        employeeId: { $in: empids },
        date: {
          $gte: date1,
          $lt: nextDay,
        },
      });
      let approved = 0;
      let pending = 0;
      let rejected = 0;

      for (let temp of attendance) {
        if (temp.status === "approved") {
          approved += 1;
        }
        if (temp.status === "pending") {
          pending += 1;
        }
        if (temp.status === "rejected") {
          rejected += 1;
        }
      }

      groupStore.push({
        groupName: group.groupName,
        totalEmployeesInGroup: employees.length,

        employeeIds: employees.map((employee) => employee._id),
        total: attendance,
        totalPresent: attendance.length,
        approved: approved,
        pending: pending,
        rejected: rejected,
      });
    }

    res.status(200).json({
      success: true,
      groupStore,
    });
  }
);

export const departmentOverView = catchErrorAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { date } = req.query;

    let nextDay: any;
    let date1: any;
    if (typeof date === "string") {
      date1 = new Date(date);
      date1.setHours(0, 0, 0, 0);
      // date1.setHours(date1.getHours() - 6);

      nextDay = new Date(date1);
      nextDay.setDate(nextDay.getDate() + 1);
      nextDay.setHours(0, 0, 0, 0);
    } else {
      date1 = new Date();
      date1.setHours(0, 0, 0, 0);
      // date1.setHours(date1.getHours() - 6);

      nextDay = new Date(date1);
      nextDay.setDate(nextDay.getDate() + 1);
      nextDay.setHours(0, 0, 0, 0);
    }
    // date1 = getIndianTime(date1);
    // nextDay = getIndianTime(nextDay);

    const allDepartment = await departmentModel.find({});
    const departmentStore = [];

    for (const depart of allDepartment) {
      const jobProfiles = await JobProfileModel.find({
        department: depart._id,
      }).exec();
      const employees = await EmployeeModel.find({
        jobProfileId: { $in: jobProfiles },
      })
        .lean()
        .exec();
      const empids = employees.map((employee: any) => employee._id);
      const attendance = await v2AttendanceModel.find({
        employeeId: { $in: empids },
        date: {
          $gte: date1,
          $lt: nextDay,
        },
      });
      let approved = 0;
      let pending = 0;
      let rejected = 0;

      for (let temp of attendance) {
        if (temp.status === "approved") {
          approved += 1;
        }
        if (temp.status === "pending") {
          pending += 1;
        }
        if (temp.status === "rejected") {
          rejected += 1;
        }
      }

      departmentStore.push({
        departmentName: depart.departmentName,
        totalEmployeesInGroup: employees.length,
        //employeeIds: employees.map((employee) => employee._id),
        totalPresent: attendance.length,
        approved: approved,
        pending: pending,
        rejected: rejected,
      });
    }

    res.status(200).json({
      success: true,
      departmentStore,
    });
  }
);
export const shopOverView = catchErrorAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { date } = req.query;

    let nextDay: any;
    let date1: any;
    if (typeof date === "string") {
      date1 = new Date(date);
      date1.setHours(0, 0, 0, 0);
      // date1.setHours(date1.getHours() - 6);

      nextDay = new Date(date1);
      nextDay.setDate(nextDay.getDate() + 1);
      nextDay.setHours(0, 0, 0, 0);
    } else {
      date1 = new Date();
      date1.setHours(0, 0, 0, 0);
      // date1.setHours(date1.getHours() - 6);

      nextDay = new Date(date1);
      nextDay.setDate(nextDay.getDate() + 1);
      nextDay.setHours(0, 0, 0, 0);
    }
    // date1 = getIndianTime(date1);
    // nextDay = getIndianTime(nextDay);

    const allShops = await ShopModel.find({})
      .populate({
        path: "jobProfile",
      })
      .exec();
    const shopStore = [];

    for (const shop of allShops) {
      const jobprofile = await JobProfileModel.find({
        _id: shop.jobProfile.jobProfileId,
      });
      //console.log("HIII",jobprofile)
      const jobprofileIds = jobprofile.map((job) => job._id);
      const employee = await EmployeeModel.find({
        jobProfileId: { $in: jobprofileIds },
      });
      const empIds = employee.map((e) => e._id);
      //console.log("temp",empIds)

      const attendance = await v2AttendanceModel.find({
        approvedBy: { $in: empIds },
        date: {
          $gte: date1,
          $lt: nextDay,
        },
      });
      let approved = 0;
      let pending = 0;
      let rejected = 0;
      let manual = 0;

      for (let temp of attendance) {
        if (temp.status === "approved") {
          approved += 1;
        }
        if (temp.status === "pending") {
          pending += 1;
        }
        if (temp.status === "rejected") {
          rejected += 1;
        }
        if (temp.status === "added Manually by administrator") {
          manual += 1;
        }
      }

      shopStore.push({
        shopName: shop.shopName,
        //totalEmployeesInGroup: employees.length,

        //employeeIds: employees.map((employee) => employee._id),
        total: attendance,
        totalPresent: attendance.length,
        approved: approved,
        //pending: pending,
        manual: manual,
        rejected: rejected,
      });
    }

    res.status(200).json({
      success: true,
      shopStore,
    });
  }
);

export const getPunchRecordsNumber = catchErrorAsync(
  async (
    req: CustomRequest<EmployeeDocument>,
    resp: Response,
    next: NextFunction
  ) => {
    let {
      date,
      nextDate,
      groupName,
      departmentName,
      jobProfileName,
      name,
      limit = 20,
      page = 1,
    } = req.body;

    limit = +limit;
    page = +page;
    const skip = (page - 1) * limit;

    let filterDate;
    let nextDay;
    if (typeof date === "string") {
      filterDate = new Date(date);
      filterDate.setHours(0, 0, 0, 0);
      // filterDate.setHours(filterDate.getHours() - 6);
    } else {
      filterDate = new Date();
      filterDate.setHours(0, 0, 0, 0);
      // filterDate.setHours(filterDate.getHours() - 6);
    }
    if (typeof nextDate === "string") {
      nextDay = new Date(nextDate);
      nextDay.setHours(0, 0, 0, 0);
      nextDay.setDate(nextDay.getDate() + 1);
      // nextDay.setHours(nextDay.getHours() - 6);
    } else {
      nextDay = new Date(filterDate);
      nextDay.setDate(filterDate.getDate() + 1);
      nextDay.setHours(0, 0, 0, 0);
      // nextDay.setHours(nextDay.getHours() - 6);
    }

    // const isHR = jobProfile?.jobProfileName.toLowerCase() === "hr";
    // const isAdmin = req.admin;
    const filter: any = {};
    const filter1: any = {};
    let jobProfileIds: any = [];
    if (
      groupName &&
      Array.isArray(groupName) &&
      groupName.some((name) => name.trim() !== "")
    ) {
      const nonEmptyGroupNames = groupName.filter((name) => name.trim() !== "");
      const groups = await groupModel
        .find({ groupName: { $in: nonEmptyGroupNames } })
        .exec();
      const groupIds: any = groups.map((group) => group._id);
      filter.groupId = { $in: groupIds };
    }

    // Add departmentName filter if provided and non-empty
    if (
      departmentName &&
      Array.isArray(departmentName) &&
      departmentName.some((name) => name.trim() !== "")
    ) {
      const nonEmptyDepartmentNames = departmentName.filter(
        (name) => name.trim() !== ""
      );
      const departments = await departmentModel
        .find({ departmentName: { $in: nonEmptyDepartmentNames } })
        .exec();
      const departmentIds: any = departments.map(
        (department) => department._id
      );
      const jobProfiles = await JobProfileModel.find({
        department: { $in: departmentIds },
      }).exec();
      const jobProfileIds: any = jobProfiles.map(
        (jobProfile) => jobProfile._id
      );
      filter.jobProfileId = { $in: jobProfileIds };
    }

    // Add jobProfileName filter if provided and non-empty
    if (
      jobProfileName &&
      Array.isArray(jobProfileName) &&
      jobProfileName.some((name) => name.trim() !== "")
    ) {
      const nonEmptyJobProfileNames = jobProfileName.filter(
        (name) => name.trim() !== ""
      );
      const jobProfiles = await JobProfileModel.find({
        jobProfileName: { $in: nonEmptyJobProfileNames },
      }).exec();
      const ids: any = jobProfiles.map((jobProfile) => jobProfile._id);
      jobProfileIds = [...jobProfileIds, ...ids];
      filter.jobProfileId = { $in: jobProfileIds };
    }

    if (name) {
      filter.$or = [{ name: name }, { employeeCode: name }];
      filter1.$or = [{ name: name }, { employeeCode: name }];
    }
    // const punchIn: any[] = [];
    // const punchOut: any[] = [];
    let countIn = 0;
    let countOut = 0;
    let totalPresent = 0;
    const totalEmployees = await EmployeeModel.countDocuments();
    const employeeid = await EmployeeModel.find(filter).exec();
    const ids = employeeid.map((employee) => employee._id);
    const allData: any[] = await v2AttendanceModel

      .find({
        employeeId: { $in: ids },
        date: {
          $gte: filterDate,
          $lt: nextDay,
        },
      })
      .populate({ path: "employeeId", select: "name" })
      .populate({ path: "punches.punchInBy", select: "name" })
      .populate({ path: "punches.punchOutBy", select: "name" })
      .populate("approvedBy")
      .exec();
    totalPresent = allData.length;
    for (let data of allData) {
      const firstPunchIn = data.punches[0].punchIn;
      const lastPunchOut = data.punches[data.punches.length - 1].punchOut;
      if (firstPunchIn !== null) {
        countIn += 1;
      }
      if (lastPunchOut !== null) {
        countOut += 1;
      }
    }

    resp.status(200).json({
      success: true,
      message: "All attendance successfully.",
      countIn: countIn,
      countOut: countOut,
      totalEmployees,
      totalPresent,
    });
  }
);

export const updatePunchOut = catchErrorAsync(
  async (
    req: CustomRequest<EmployeeDocument>,
    resp: Response,
    next: NextFunction
  ) => {
    if (req.supervisor) {
      let { id } = req.params;
      let { punchIn, punchOut, date, remarks, shift } = req.body;
      let employee = await EmployeeModel.findById(id);
      if (!employee) {
        resp.status(400).json({
          success: false,
          message: req.supervisor._id,
        });
      }

      const attendanceRecord = await v2AttendanceModel.findOne({
        employeeId: employee?._id,
        date: date,
      });
      if (attendanceRecord) {
        const obj = [
          {
            punchIn: punchIn,
            punchOut: punchOut,
            employeeId: employee?._id,
            punchInBy: req.supervisor._id,
          },
        ];
        const remark = [
          {
            remark: remarks,
            createdAt: Date.now(),
            by: req.supervisor._id,
          },
        ];
        const updateAttendance = await v2AttendanceModel.findByIdAndUpdate(
          attendanceRecord._id,
          {
            shift: shift,
            $push: { remarks: remark },
            punches: obj,
            status: "added Manually by administrator",
          },
          { new: true }
        );

        resp.status(200).json({
          success: true,
          updateAttendance,
          message: "record updated successfully",
        });
      } else {
        resp.status(400).json({
          success: false,
          message: "Record not found create new.",
        });
      }
    } else {
      resp.status(400).json({
        success: false,
        message: "Login first as supervisor",
      });
    }
  }
);