import express from "express";
import { EmployeeReport, SingleEmployeeReport, getReportPerEmployee, getReportPerMachine, singleMachineReport } from "../controllers/bomControllers/productivityReportController";


const productivityReportRouter = express.Router();



productivityReportRouter.route("/getReport").post(getReportPerEmployee);

productivityReportRouter.route("/getMachineReport").post(getReportPerMachine);

productivityReportRouter.route("/getReportApp").post(EmployeeReport);

productivityReportRouter.route("/singleEmployeeReport").post(async (req,resp,next)=>{
try {
    const data = await SingleEmployeeReport(req.body);
   resp.status(200).json({...data});
} catch (error) {
    resp.sendStatus(400);
}
});

productivityReportRouter.route("/singleMachineReport").post(singleMachineReport)

export default productivityReportRouter;